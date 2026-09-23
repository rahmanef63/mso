import { afterEach, describe, expect, it, vi } from "vitest";
import { workflowEmbeds, listWorkflowEmbeds, workflowEmbedSettings } from "./workflow-embeds-api";
const cockpit = "https://mso.example.com";
const app = { id: "editor", title: "Editor", description: "Reviewed external editor", origin: "https://n8n.mso.example.com", startPath: "/editor", externalAuthPath: "/signin", renderer: "iframe" as const, presentation: "inline" as const, environment: "production" as const, placements: ["n8n", "mcp-page"] as Array<"n8n" | "mcp-page"> };
afterEach(() => vi.unstubAllEnvs());
describe("external editor session-cookie isolation", () => {
  it.each(["mso.example.com", ".MSO.EXAMPLE.COM", " example.com "])("blocks frames AND navigation under cookie domain %s", domain => {
    vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", domain);
    const result = workflowEmbeds([app], [cockpit])[0];
    expect(result).toMatchObject({ id: "editor", renderer: "remote", blocked: true });
    expect(result.url).toBeUndefined(); expect(result.loginUrl).toBeUndefined();
    expect(result.reason).toContain("session cookie");
  });
  it("does not offer unsafe top-level navigation for remote-only providers", () => {
    vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "mso.example.com");
    expect(workflowEmbeds([{ ...app, renderer: "remote" }], [cockpit])[0].url).toBeUndefined();
  });
  it("allows a separately hosted editor and rejects label-prefix tricks", () => {
    vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "mso.example.com");
    for (const origin of ["https://n8n.example.com", "https://othermso.example.com", "https://mso.example.com.editor.test"]) {
      expect(workflowEmbeds([{ ...app, origin }], [cockpit])[0]).toMatchObject({ renderer: "iframe", url: origin + "/editor" });
    }
  });
  it("protects host-only cookies across different ports without disabling sibling hosts", () => {
    vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "");
    expect(workflowEmbeds([{ ...app, origin: cockpit + ":8443" }], [cockpit])[0].url).toBeUndefined();
    expect(workflowEmbeds([app], [cockpit])[0].renderer).toBe("iframe");
    expect(workflowEmbeds([{ ...app, origin: cockpit }], [cockpit])[0]).toMatchObject({ renderer: "remote", url: cockpit + "/editor" });
  });
  it("rechecks runtime cookie policy through settings, list and shared Page readers", async () => {
    vi.stubEnv("OS_PUBLIC_ORIGIN", cockpit);
    vi.stubEnv("MSO_SURFACE_APPS_JSON", JSON.stringify([app]));
    vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "mso.example.com");
    expect((await listWorkflowEmbeds("http://localhost:4005"))[0].url).toBeUndefined();
    expect((await workflowEmbedSettings("http://localhost:4005")).apps[0].url).toBeUndefined();
    vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "");
    expect((await listWorkflowEmbeds("http://localhost:4005"))[0].renderer).toBe("iframe");
  });
});
