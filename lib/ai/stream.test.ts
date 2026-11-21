import { afterEach, describe, expect, it, vi } from "vitest";
import { streamAgentTurn } from "./stream";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseResponse(body: string, status = 200): Response {
  return new Response(new TextEncoder().encode(body), {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("streamAgentTurn", () => {
  it("parses usage from the done event when present", async () => {
    const sse = [
      "event: delta\ndata: \"Hello world\"\n\n",
      "event: done\ndata: {\"stopReason\":\"end_turn\",\"usage\":{\"inputTokens\":42,\"outputTokens\":18,\"cacheReadTokens\":10}}\n\n",
    ].join("");

    globalThis.fetch = vi.fn().mockResolvedValue(sseResponse(sse));

    const deltas: string[] = [];
    const turn = await streamAgentTurn([], [], (c) => deltas.push(c));

    expect(turn.text).toBe("Hello world");
    expect(deltas).toEqual(["Hello world"]);
    expect(turn.stopReason).toBe("end_turn");
    expect(turn.usage).toEqual({
      inputTokens: 42,
      outputTokens: 18,
      cacheReadTokens: 10,
    });
  });

  it("leaves usage undefined when absent from the done event", async () => {
    const sse = [
      "event: delta\ndata: \"No usage here\"\n\n",
      "event: done\ndata: {\"stopReason\":\"end_turn\"}\n\n",
    ].join("");

    globalThis.fetch = vi.fn().mockResolvedValue(sseResponse(sse));

    const turn = await streamAgentTurn([], [], () => {});

    expect(turn.text).toBe("No usage here");
    expect(turn.stopReason).toBe("end_turn");
    expect(turn.usage).toBeUndefined();
  });

  it("leaves usage undefined when done payload has usage: null", async () => {
    const sse = [
      "event: done\ndata: {\"stopReason\":\"end_turn\",\"usage\":null}\n\n",
    ].join("");

    globalThis.fetch = vi.fn().mockResolvedValue(sseResponse(sse));

    const turn = await streamAgentTurn([], [], () => {});

    expect(turn.usage).toBeUndefined();
  });

  it("throws on error event in stream", async () => {
    const sse = [
      "event: error\ndata: \"provider_overloaded\"\n\n",
    ].join("");

    globalThis.fetch = vi.fn().mockResolvedValue(sseResponse(sse));

    await expect(streamAgentTurn([], [], () => {})).rejects.toThrow("provider_overloaded");
  });

  it("throws when fetch response is not ok", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }));

    await expect(streamAgentTurn([], [], () => {})).rejects.toThrow("unauthorized");
  });

  it("streams reasoning deltas separately from text deltas", async () => {
    const sse = [
      "event: reasoning\ndata: \"Check disk first. \"\n\n",
      "event: delta\ndata: \"Disk is 42% full.\"\n\n",
      "event: done\ndata: {\"stopReason\":\"end_turn\"}\n\n",
    ].join("");
    globalThis.fetch = vi.fn().mockResolvedValue(sseResponse(sse));
    const deltas: string[] = [];
    const thoughts: string[] = [];
    const turn = await streamAgentTurn([], [], (c) => deltas.push(c), undefined, undefined, (r) => thoughts.push(r));
    expect(thoughts).toEqual(["Check disk first. "]);
    expect(deltas).toEqual(["Disk is 42% full."]);
    expect(turn.reasoning).toBe("Check disk first. ");
    expect(turn.text).toBe("Disk is 42% full.");
  });
});
