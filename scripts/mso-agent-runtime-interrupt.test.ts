import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAbortError } from "./mso-agent-interrupt.mjs";
import { streamTurn } from "./mso-agent-runtime.mjs";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("MSO Agent assistant stream cancellation", () => {
  it("passes the turn AbortSignal into the assistant fetch", async () => {
    globalThis.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error("missing AbortSignal"));
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) as typeof fetch;
    const controller = new AbortController();
    const pending = streamTurn([], [], { id: "session-test", memorySnapshot: {} }, null, controller.signal);
    controller.abort(makeAbortError("test interrupt"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "test interrupt" });
  });
});
