import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_N8N_SANDBOX,
  buildN8nSurfaceApp,
  extractN8nFormDefaults,
  formatN8nSurfaceError,
  parseN8nAuthPath,
  parseN8nSurfaceUrl,
} from "./n8n-url";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("n8n URL and surface payload helpers", () => {
  it("parses valid HTTPS n8n URLs with root and nested paths", () => {
    expect(parseN8nSurfaceUrl("https://n8n.example.test")).toEqual({
      ok: true,
      origin: "https://n8n.example.test",
      startPath: "/",
    });
    expect(parseN8nSurfaceUrl("  https://n8n.example.test/home/workflows  ")).toEqual({
      ok: true,
      origin: "https://n8n.example.test",
      startPath: "/home/workflows",
    });
  });

  it("rejects empty, HTTP, credential-bearing, query-bearing, and traversal URLs", () => {
    expect(parseN8nSurfaceUrl("").ok).toBe(false);
    expect(parseN8nSurfaceUrl("not-a-url").ok).toBe(false);
    expect(parseN8nSurfaceUrl("http://n8n.example.test").ok).toBe(false);
    expect(parseN8nSurfaceUrl("https://user:pass@n8n.example.test/").ok).toBe(false);
    expect(parseN8nSurfaceUrl("https://n8n.example.test/?token=secret").ok).toBe(false);
    expect(parseN8nSurfaceUrl("https://n8n.example.test/#frag").ok).toBe(false);
    expect(parseN8nSurfaceUrl("https://n8n.example.test//evil").ok).toBe(false);
  });

  it("validates optional sign-in paths without queries or traversal", () => {
    expect(parseN8nAuthPath("")).toEqual({ ok: true });
    expect(parseN8nAuthPath("/signin")).toEqual({ ok: true, path: "/signin" });
    expect(parseN8nAuthPath("signin").ok).toBe(false);
    expect(parseN8nAuthPath("//evil.test/signin").ok).toBe(false);
    expect(parseN8nAuthPath("/signin?token=bad").ok).toBe(false);
    expect(parseN8nAuthPath("/signin#hash").ok).toBe(false);
    expect(parseN8nAuthPath("/a/../b").ok).toBe(false);
  });

  it("builds a dedicated n8n surface payload preserving existing sandbox and description", () => {
    const fresh = buildN8nSurfaceApp({
      url: "https://n8n.example.test/home/workflows",
      authPath: "/signin",
      embed: true,
    });
    expect(fresh).toEqual({
      ok: true,
      app: {
        id: "n8n",
        title: "n8n",
        description: "n8n automation editor",
        origin: "https://n8n.example.test",
        startPath: "/home/workflows",
        renderer: "iframe",
        presentation: "inline",
        environment: "production",
        placements: ["n8n"],
        sandbox: DEFAULT_N8N_SANDBOX,
        externalAuthPath: "/signin",
      },
    });

    const updated = buildN8nSurfaceApp({
      url: "https://n8n.example.test/",
      embed: false,
      existing: {
        id: "n8n",
        title: "n8n",
        description: "Custom description",
        origin: "https://old.example.test",
        url: "https://old.example.test/",
        renderer: "iframe",
        sandbox: "allow-scripts allow-forms",
      },
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.app.renderer).toBe("remote");
      expect(updated.app.description).toBe("Custom description");
      expect(updated.app.sandbox).toBe("allow-scripts allow-forms");
      expect(updated.app.externalAuthPath).toBeUndefined();
    }
  });

  it("extracts form defaults from configured or blocked surfaces", () => {
    expect(extractN8nFormDefaults(null)).toEqual({ url: "", authPath: "", embed: true });
    expect(
      extractN8nFormDefaults({
        id: "n8n",
        title: "n8n",
        description: "",
        origin: "https://n8n.example.test",
        url: "https://n8n.example.test/editor",
        loginUrl: "https://n8n.example.test/signin",
        renderer: "iframe",
        sandbox: DEFAULT_N8N_SANDBOX,
      }),
    ).toEqual({ url: "https://n8n.example.test/editor", authPath: "/signin", embed: true });
    expect(
      extractN8nFormDefaults({
        id: "n8n",
        title: "n8n",
        description: "",
        origin: "https://blocked.example.test",
        blocked: true,
        renderer: "remote",
        sandbox: DEFAULT_N8N_SANDBOX,
      }),
    ).toEqual({ url: "https://blocked.example.test", authPath: "", embed: false });
  });

  it("formats server errors into plain user-visible copy without em dashes", () => {
    const codes: Array<[string | undefined, number | undefined]> = [
      ["owner_required", 403],
      ["surface_registry_changed_reload", 409],
      ["surface_registry_managed_by_environment", 400],
      ["surface_owned_by_shell", 409],
      ["workflow_login_path_must_not_contain_query", 400],
      ["invalid_surface_metadata", 400],
      ["rate_limited", 429],
      [undefined, 500],
    ];
    for (const [code, status] of codes) {
      const text = formatN8nSurfaceError(code, status);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain("\u2014");
    }
  });

  it("derives the suggested n8n placeholder from NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE without hardcoding domains", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "{id}-mso.example.test");
    const withTemplate = await import("./n8n-url");
    expect(withTemplate.suggestedN8nUrl()).toBe("https://n8n-mso.example.test");

    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "");
    const withoutTemplate = await import("./n8n-url");
    expect(withoutTemplate.suggestedN8nUrl()).toBe("https://n8n.example.com");
  });
});
