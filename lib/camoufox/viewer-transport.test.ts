import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { inspectViewerTransport } from "./viewer-transport";
import { CAMOUFOX_VIEWER_ENTRY_PATH } from "./viewer-path";

describe("Camoufox public transport is separate from power", () => {
  it("does not probe an absent origin", async () => {
    const fetcher = vi.fn();
    expect(await inspectViewerTransport(null, fetcher)).toMatchObject({ reachable: false, state: "unconfigured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([200, 401, 403, 404])("accepts HTTP %s only as transport evidence without credentials", async status => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    expect(await inspectViewerTransport("https://camoufox.example.com", fetcher)).toMatchObject({ reachable: true, status });
    const [target, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(target.href).toBe("https://camoufox.example.com" + CAMOUFOX_VIEWER_ENTRY_PATH);
    expect(init).toMatchObject({ method: "HEAD", redirect: "error", cache: "no-store" });
    expect(init.headers).toBeUndefined();
  });
  it.each([302, 500, 502])("does not follow or accept HTTP %s", async status => {
    expect(await inspectViewerTransport("https://camoufox.example.com", async () => new Response(null, { status }))).toMatchObject({ reachable: false, state: "http" });
  });
  it("reports nested TLS errors without leaking raw exception text", async () => {
    const fetcher = vi.fn(async () => { throw new Error("secret-value", { cause: { code: "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE" } }); });
    const result = await inspectViewerTransport("https://camoufox.example.com", fetcher);
    expect(result).toMatchObject({ reachable: false, state: "tls" });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
  it("distinguishes DNS failure", async () => {
    expect(await inspectViewerTransport("https://camoufox.example.com", async () => { throw { code: "ENOTFOUND" }; })).toMatchObject({ state: "dns" });
  });
  it.each(["http://example.com", "https://user:pass@example.com", "https://example.com/path"])('refuses malformed origin %s before a request', async origin => {
    const fetcher = vi.fn(); await inspectViewerTransport(origin, fetcher); expect(fetcher).not.toHaveBeenCalled();
  });
});
