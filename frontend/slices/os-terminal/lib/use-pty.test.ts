import { afterEach, describe, expect, it, vi } from "vitest";
import { startPty, type PtyStatus } from "./use-pty";

class Stream {
  static CLOSED = 2;
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("terminal input delivery", () => {
  it.each(["HTTP failure", "network failure"])("stops without replay after %s", async (failure) => {
    let rejectInput!: (reason: Error) => void;
    let resolveInput!: (response: Response) => void;
    const input = new Promise<Response>((resolve, reject) => { resolveInput = resolve; rejectInput = reject; });
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/open")) return Promise.resolve({ ok: true, json: async () => ({ id: "test" }) });
      if (url.endsWith("/input")) return input;
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", Stream);
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const statuses: PtyStatus[] = [];
    const handle = await startPty({ cols: 80, rows: 24, onData: () => {}, onStatus: (s) => statuses.push(s) });
    handle.write("first");
    handle.write("queued");
    if (failure === "HTTP failure") resolveInput({ ok: false } as Response);
    else rejectInput(new Error("connection lost"));
    await vi.waitFor(() => expect(statuses.at(-1)).toMatchObject({ kind: "error", message: expect.stringContaining("uncertain") }));
    handle.write("later");
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/input"))).toHaveLength(1);
    handle.dispose();
  });
});
