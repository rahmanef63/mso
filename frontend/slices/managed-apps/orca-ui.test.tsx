import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
});

import { renderToStaticMarkup } from "react-dom/server";
import { getManagedAppDefinition } from "@/lib/managed-apps/catalog";
import { supportFor } from "./app-support";
import { installApp } from "./update-api";
import { resolveAuthorizedFrameUrl, ManagedFeatureApp } from "./feature-app";
import { OrcaApp } from "./app";

describe("Orca UI behavior and state transitions", () => {
  it("renders initial loading state while app detection is pending", () => {
    const html = renderToStaticMarkup(<OrcaApp />);
    expect(html).toContain("Orca");
    expect(html).toContain("Detecting Orca");
  });

  it("enforces that installer is unavailable until real verified adapter is provided", async () => {
    const def = getManagedAppDefinition("orca");
    expect(def.installBackends).toEqual([]);
    const support = supportFor("orca");
    expect(support.installCommand).toBe("");
    expect(support.installNote).toContain("Waiting for verified upstream packaging");
    expect(support.stateDir).toBe("~/.local/share/mso/orca");

    // Client install call gets 400/404 from backend when installBackends is empty
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Installation is not supported for orca on this host" }),
    })));

    await expect(installApp("orca")).rejects.toThrow("Installation is not supported for orca on this host");
    vi.unstubAllGlobals();
  });

  it("resolves authorized frame URL with pairing fragment and app ticket in hash, no query secrets", async () => {
    const sessionResponse = new Response(
      JSON.stringify({
        origin: "https://orca.mso.example.com",
        ticket: "ticket_xyz123",
        pairingUrl: "orca://pair?code=pairing_secret",
        webClientUrl: "https://orca.mso.example.com/#pairing=code_from_offer",
        runtimeId: "rt_1234",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    const resolved = await resolveAuthorizedFrameUrl(sessionResponse, "https://orca.mso.example.com/");
    expect(resolved.source).toBe("https://orca.mso.example.com/");

    const parsed = new URL(resolved.url);
    expect(parsed.origin).toBe("https://orca.mso.example.com");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toContain("pairing=code_from_offer");
    expect(parsed.hash).toContain("app_ticket=ticket_xyz123");
  });

  it("fails authorization for Viewer or revoked sessions and does not leak shared tokens", async () => {
    const viewerResponse = new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );

    await expect(
      resolveAuthorizedFrameUrl(viewerResponse, "https://orca.mso.example.com/"),
    ).rejects.toThrow("authorization failed");

    const html = renderToStaticMarkup(
      <ManagedFeatureApp
        feature={{
          id: "orca:overview",
          applicationId: "orca",
          title: "Orca",
          route: "/",
          source: "nav-bundle",
          available: true,
        }}
      />,
    );

    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("pairing");
    expect(html).not.toContain("ticket");
    expect(html).toContain("Authorizing application");
  });

  it("rejects authorization responses from mismatched origins", async () => {
    const evilResponse = new Response(
      JSON.stringify({
        origin: "https://evil.example.com",
        ticket: "ticket_xyz123",
        webClientUrl: "https://evil.example.com/#pairing=abc",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    await expect(
      resolveAuthorizedFrameUrl(evilResponse, "https://orca.mso.example.com/"),
    ).rejects.toThrow("authorization origin mismatch");
  });
});
