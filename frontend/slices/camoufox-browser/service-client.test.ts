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

it("surfaces public TLS failure without changing the process state", async () => {
  const { verifyViewerTransport } = await import("./service-client");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reachable: false, state: "tls", message: "Viewer TLS failed" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(verifyViewerTransport(new AbortController().signal)).rejects.toThrow("Viewer TLS failed");
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/camoufox/service?probe=viewer", expect.objectContaining({ cache: "no-store" }));
});

it("reports every observed power state and stops polling when the session stops", async () => {
  vi.useFakeTimers();
  const running = { installed: true, running: true, enabled: false, viewerReady: false };
  const stopped = { ...running, running: false };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(running), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(stopped), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const observed = vi.fn();
  try {
    const result = waitForViewer(new AbortController().signal, 30000, observed);
    await vi.advanceTimersByTimeAsync(700);
    await expect(result).resolves.toBe(false);
    expect(observed.mock.calls.map(([status]) => status.running)).toEqual([true, false]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it("does not publish a state observation after cancellation", async () => {
  const controller = new AbortController();
  const observed = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => {
    controller.abort();
    return new Response(JSON.stringify({ installed: true, running: false, enabled: false }), { status: 200 });
  }));
  await expect(waitForViewer(controller.signal, 0, observed)).resolves.toBe(false);
  expect(observed).not.toHaveBeenCalled();
});
