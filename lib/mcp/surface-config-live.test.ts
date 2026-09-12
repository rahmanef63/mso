import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root = "";
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const app = (id: string, origin: string) => ({
  id,
  title: id,
  description: `reviewed ${id}`,
  origin,
  startPath: "/embed",
  renderer: "iframe",
  presentation: "inline",
  environment: "production",
  sandbox: "allow-scripts allow-same-origin",
});

describe("owner-local MSO Page surface registry", () => {
  it("re-reads reviewed apps and keeps exact frame CSP aligned with the same HTML snapshot", async () => {
    root = await mkdtemp(join(tmpdir(), "mso-surfaces-"));
    const registry = join(root, "surface-apps.json");
    vi.stubEnv("MSO_SURFACE_APPS_JSON", undefined);
    vi.stubEnv("MSO_SURFACE_APPS_FILE", registry);
    vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
    vi.stubEnv("OS_MCP_UI_ORIGIN", "https://mso-ui.example.test");
    vi.resetModules();
    const { configuredSurfaceApps } = await import("./surface-config");
    const { msoPageResource } = await import("./ui-surface");

    await writeFile(registry, JSON.stringify([app("alpha", "https://alpha.example.test")]), { mode: 0o600 });
    expect((await configuredSurfaceApps()).map((row) => row.id)).toEqual(["alpha"]);
    let page = await msoPageResource();
    expect(page.text).toContain('"id":"alpha"');
    expect((page._meta.ui as { csp: { frameDomains?: string[] } }).csp.frameDomains).toEqual(["https://alpha.example.test"]);
    expect((page._meta["openai/widgetCSP"] as { frame_domains?: string[] }).frame_domains).toEqual(["https://alpha.example.test"]);
    expect(page.text).toContain('"renderer":"iframe"');
    expect(page.text).not.toContain("createElement(\"iframe\")");

    await writeFile(registry, JSON.stringify([app("beta", "https://beta.example.test")]), { mode: 0o600 });
    expect((await configuredSurfaceApps()).map((row) => row.id)).toEqual(["beta"]);
    page = await msoPageResource();
    expect(page.text).not.toContain('"id":"alpha"');
    expect(page.text).toContain('"id":"beta"');
    expect((page._meta.ui as { csp: { frameDomains?: string[] } }).csp.frameDomains).toEqual(["https://beta.example.test"]);
    expect((page._meta["openai/widgetCSP"] as { frame_domains?: string[] }).frame_domains).toEqual(["https://beta.example.test"]);
    expect(page.text).toContain('"renderer":"iframe"');
  });

  it("keeps an explicitly defined JSON env value as the deployment override", async () => {
    root = await mkdtemp(join(tmpdir(), "mso-surfaces-"));
    const registry = join(root, "surface-apps.json");
    await writeFile(registry, JSON.stringify([app("file", "https://file.example.test")]), { mode: 0o600 });
    vi.stubEnv("MSO_SURFACE_APPS_FILE", registry);
    vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app("env", "https://env.example.test")]));
    vi.resetModules();
    const { configuredSurfaceApps } = await import("./surface-config");
    expect((await configuredSurfaceApps()).map((row) => row.id)).toEqual(["env"]);
    vi.stubEnv("MSO_SURFACE_APPS_JSON", "");
    expect(await configuredSurfaceApps()).toEqual([]);
  });
});
