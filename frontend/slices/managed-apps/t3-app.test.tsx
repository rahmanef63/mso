import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
});

import { MANAGED_APP_IDS } from "@/lib/managed-apps/types";
import { getManagedAppDefinition, isManagedAppId, listManagedAppDefinitions } from "@/lib/managed-apps/catalog";
import { BUILTIN_APPS } from "@/frontend/slices/os-shell/shell.manifest";
import { parseAppCatalog } from "@/lib/contracts/app-catalog";
import { appAllowedForRole } from "@/lib/auth/app-access";
import { managedAppHost, managedAppOrigin, managedAppIdForHost } from "@/lib/managed-apps/origin";
import { contentSecurityPolicy } from "@/lib/managed-apps/proxy-csp";
import { pickResponseHeaders } from "@/lib/managed-apps/proxy-headers";
import { resolveAuthorizedFrame } from "./app-authorization";
import { t3App } from "./index";
import { T3CodeApp } from "./app";

describe("T3 Code managed application integration", () => {
  it("registers t3 in typed MANAGED_APP_IDS, catalog, shell manifest, and role policy", () => {
    expect(MANAGED_APP_IDS).toContain("t3");
    expect(isManagedAppId("t3")).toBe(true);
    const def = listManagedAppDefinitions().find((d) => d.id === "t3");
    expect(def).toBeDefined();
    expect(def?.name).toBe("T3 Code");
    expect(def?.command).toBe(join(process.cwd(), "scripts", "managed-app-t3"));
    expect(def?.commandProvesInstall).toBe(false);
    expect(def?.serviceNames).toEqual(["t3-code.service"]);
    expect(def?.dashboardUrl).toBe("http://127.0.0.1:3773");
    expect(def?.healthPath).toBe("/api/auth/session");
    expect(getManagedAppDefinition("t3")).toEqual(def);

    expect(t3App.id).toBe("t3");
    const shellEntry = BUILTIN_APPS.find((app) => app.id === "t3");
    expect(shellEntry?.slug).toBe("t3");

    expect(parseAppCatalog(JSON.stringify({
      schema: "urn:manef:app-catalog:v1",
      schemaVersion: 1,
      entries: [{ kind: "managed", id: "t3" }],
    })).entries).toEqual([{ kind: "managed", id: "t3" }]);

    expect(appAllowedForRole("t3", "viewer")).toBe(false);
    expect(appAllowedForRole("t3", "operator")).toBe(true);
    expect(appAllowedForRole("t3", "owner")).toBe(true);
  });

  it("isolates T3 origin and overrides upstream X-Frame-Options/frame-ancestors for split-origin framing", () => {
    expect(managedAppHost("t3")).toBe("t3.mso.example.com");
    expect(managedAppOrigin("t3")).toBe("https://t3.mso.example.com");
    expect(managedAppIdForHost("t3.mso.example.com")).toBe("t3");

    const upstream = new Headers({
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
    });
    const picked = pickResponseHeaders(upstream);
    expect(picked.get("x-frame-options")).toBeNull();

    const csp = contentSecurityPolicy("https://t3.mso.example.com/", upstream.get("content-security-policy"), {
      cockpitOrigin: "https://mso.example.com",
      appId: "t3",
    });
    expect(csp).toContain("frame-ancestors 'self' https://mso.example.com");
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src https://t3.mso.example.com/ blob:");
  });

  it("exports T3CodeApp component and renders initial detecting state", () => {
    const html = renderToStaticMarkup(<T3CodeApp />);
    expect(html).toContain("Detecting T3 Code");
  });

  it("frames canonical T3 /pair#token=... URLs with app_ticket in the fragment and falls back safely", async () => {
    const origin = "https://t3.mso.example.com";
    const ok = (body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

    const paired = await resolveAuthorizedFrame(
      ok({ origin, ticket: "ticket_abc", webClientUrl: `${origin}/pair#token=t3_one_time_12345` }),
      `${origin}/`,
      "t3",
    );
    const parsed = new URL(paired.url);
    expect(parsed.origin).toBe(origin);
    expect(parsed.pathname).toBe("/pair");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toContain("token=t3_one_time_12345");
    expect(parsed.hash).toContain("app_ticket=ticket_abc");

    const fallback = await resolveAuthorizedFrame(ok({ origin, ticket: "ticket_abc" }), `${origin}/`, "t3");
    expect(new URL(fallback.url).pathname).toBe("/");

    await expect(
      resolveAuthorizedFrame(ok({ origin, ticket: "ticket_abc", webClientUrl: `${origin}/pair?token=leak#token=abc` }), `${origin}/`, "t3"),
    ).rejects.toThrow("authorization origin mismatch");
    await expect(
      resolveAuthorizedFrame(ok({ origin, ticket: "ticket_abc", webClientUrl: `${origin}/other#token=abc` }), `${origin}/`, "t3"),
    ).rejects.toThrow("authorization origin mismatch");
  });
});
