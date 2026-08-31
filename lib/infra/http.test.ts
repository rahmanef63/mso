import { describe, expect, it, vi } from "vitest";
import { MAX_RESPONSE_BYTES, request } from "./http";

describe("infrastructure HTTP response bounds", () => {
  it("cancels an oversized streaming response before reading another chunk", async () => {
    let cancelled = false;
    let pulls = 0;
    const first = new Uint8Array(MAX_RESPONSE_BYTES - 8);
    const second = new Uint8Array(16);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(first);
        else if (pulls === 2) controller.enqueue(second);
        else throw new Error("oversized response reader consumed an extra chunk");
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));

    await expect(request("https://provider.example/api", {}, 1_000, fetchImpl)).rejects.toThrow(
      `provider response exceeds ${MAX_RESPONSE_BYTES} bytes`,
    );
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
  });

  it("rejects an oversized declared content length without pulling the body", async () => {
    let pulled = false;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled = true; controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const fetchImpl = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
    }));

    await expect(request("https://provider.example/api", {}, 1_000, fetchImpl)).rejects.toThrow(
      `provider response exceeds ${MAX_RESPONSE_BYTES} bytes`,
    );
    expect(cancelled).toBe(true);
    expect(pulled).toBe(false);
  });
});
