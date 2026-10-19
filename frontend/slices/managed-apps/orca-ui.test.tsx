import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
});

import { renderToStaticMarkup } from "react-dom/server";
import { getManagedAppDefinition } from "@/lib/managed-apps/catalog";
import { supportFor } from "./app-support";
import { installApp } from "./update-api";
import { requestAuthorizedFrame, resolveAuthorizedFrame, selectAuthorizedFrame } from "./app-authorization";
import { ManagedFeatureApp } from "./feature-app";
import { OrcaApp } from "./app";

const ORIGIN = "https://orca.mso.example.com";
const WEB_CLIENT_URL = `${ORIGIN}/web-index.html#pairing=orca%3A%2F%2Fpair%3Fcode%3Dabc`;

function okResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Orca UI state and installer availability", () => {
  it("renders initial loading state while app detection is pending", () => {
    const html = renderToStaticMarkup(<OrcaApp />);
    expect(html).toContain("Orca");
    expect(html).toContain("Detecting Orca");
  });

  it("keeps the installer unavailable until a real verified adapter exists", async () => {
    const def = getManagedAppDefinition("orca");
    expect(def.installBackends).toEqual([]);
    const support = supportFor("orca");
    expect(support.installCommand).toBe("");
    expect(support.installNote).toContain("Waiting for verified upstream packaging");
    expect(support.stateDir).toBe("~/.local/share/mso/orca");

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Installation is not supported for orca on this host" }),
    })));
    await expect(installApp("orca")).rejects.toThrow("Installation is not supported for orca on this host");
    vi.unstubAllGlobals();
  });
});

describe("managed-app authorization pipeline (real Response, real abort)", () => {
  it("frames the canonical Orca web client with the app ticket in the fragment only", async () => {
    const resolved = await resolveAuthorizedFrame(
      okResponse({ origin: ORIGIN, ticket: "ticket_xyz123", pairingUrl: "orca://pair?code=abc", webClientUrl: WEB_CLIENT_URL, runtimeId: "rt_1234" }),
      `${ORIGIN}/`,
      "orca",
    );
    const parsed = new URL(resolved.url);
    expect(parsed.origin).toBe(ORIGIN);
    expect(parsed.pathname).toBe("/web-index.html");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toContain("pairing=");
    expect(parsed.hash).toContain("app_ticket=ticket_xyz123");
  });

  it("refuses an Orca web client that carries a query secret, wrong path, or unrelated origin", async () => {
    await expect(resolveAuthorizedFrame(okResponse({ origin: ORIGIN, ticket: "t", webClientUrl: `${ORIGIN}/web-index.html?token=leak#pairing=x` }), `${ORIGIN}/`, "orca")).rejects.toThrow("authorization origin mismatch");
    await expect(resolveAuthorizedFrame(okResponse({ origin: ORIGIN, ticket: "t", webClientUrl: `${ORIGIN}/other.html#pairing=x` }), `${ORIGIN}/`, "orca")).rejects.toThrow("authorization origin mismatch");
    await expect(resolveAuthorizedFrame(okResponse({ origin: ORIGIN, ticket: "t", webClientUrl: "https://evil.example.com/web-index.html#pairing=x" }), `${ORIGIN}/`, "orca")).rejects.toThrow("authorization origin mismatch");
    await expect(resolveAuthorizedFrame(okResponse({ origin: ORIGIN, ticket: "t" }), `${ORIGIN}/`, "orca")).rejects.toThrow("authorization origin mismatch");
  });

  it("never lets a non-Orca app navigate to a server-supplied web client URL", async () => {
    const resolved = await resolveAuthorizedFrame(okResponse({ origin: "https://hermes.mso.example.com", ticket: "t" }), "https://hermes.mso.example.com/", "hermes");
    expect(new URL(resolved.url).pathname).toBe("/");
    await expect(
      resolveAuthorizedFrame(okResponse({ origin: "https://hermes.mso.example.com", ticket: "t", webClientUrl: "https://hermes.mso.example.com/other" }), "https://hermes.mso.example.com/", "hermes"),
    ).rejects.toThrow("authorization origin mismatch");
  });

  it("rejects 401 and mismatched-origin responses without producing a frame URL", async () => {
    await expect(resolveAuthorizedFrame(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }), `${ORIGIN}/`, "orca")).rejects.toThrow("authorization failed");
    await expect(resolveAuthorizedFrame(okResponse({ origin: "https://evil.example.com", ticket: "t", webClientUrl: WEB_CLIENT_URL }), `${ORIGIN}/`, "orca")).rejects.toThrow("authorization origin mismatch");
  });

  it("aborts a stale in-flight authorization request so it cannot mount an old frame", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const controller = new AbortController();
    const pending = requestAuthorizedFrame("orca", `${ORIGIN}/`, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    vi.unstubAllGlobals();
  });

  it("ignores a result stamped with an older generation after a refresh", () => {
    const frame = { source: `${ORIGIN}/`, url: `${WEB_CLIENT_URL}&app_ticket=old` };
    const stale = { generation: 0, auth: frame, error: false };
    expect(selectAuthorizedFrame(stale, 1, `${ORIGIN}/`)).toEqual({ url: null, error: false });
    expect(selectAuthorizedFrame({ generation: 1, auth: frame, error: false }, 1, `${ORIGIN}/`)).toEqual({ url: frame.url, error: false });
    expect(selectAuthorizedFrame({ generation: 1, auth: null, error: true }, 1, `${ORIGIN}/`)).toEqual({ url: null, error: true });
  });
});

describe("Orca frame surface safety (SSR branches)", () => {
  it("shows no iframe and leaks no token before authorization completes", () => {
    const html = renderToStaticMarkup(
      <ManagedFeatureApp
        feature={{ id: "orca:overview", applicationId: "orca", title: "Orca", route: "/", source: "nav-bundle", available: true }}
      />,
    );
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("pairing");
    expect(html).not.toContain("ticket");
    expect(html).toContain("Authorizing application");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
