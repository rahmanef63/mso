import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForViewer } from "./service-client";

afterEach(() => vi.unstubAllGlobals());

describe("Camoufox viewer readiness", () => {
  it("polls only the authenticated same-origin service status", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      installed: true, running: true, enabled: false, viewerReady: true,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForViewer(new AbortController().signal, 100)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/camoufox/service", expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/camoufox-vnc/"), expect.anything());
  });

  it("does not treat systemd running as viewer-ready", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      installed: true, running: true, enabled: false, viewerReady: false,
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(waitForViewer(new AbortController().signal, 0)).resolves.toBe(false);
  });
});
