import { describe, it, expect, vi, afterEach } from "vitest";
import { streamOpenAI } from "./openai-stream";

// Emit one Uint8Array per piece so we can split an SSE line mid-way and prove the
// parser reassembles across reads.
function sseStream(pieces: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < pieces.length) c.enqueue(enc.encode(pieces[i++]));
      else c.close();
    },
  });
}

const resolved = { baseUrl: "https://x/v1", apiKey: "k", model: "gpt", provider: "openai" };

afterEach(() => vi.unstubAllGlobals());

describe("streamOpenAI", () => {
  it("streams deltas and reassembles a tool_call split across chunks + reads", async () => {
    const pieces = [
      `data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n`,
      // second piece ends mid-line (no trailing \n) to test cross-read buffering
      `data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","fun`,
      `ction":{"name":"fs_list","arguments":"{\\"path\\":"}}]}}]}\n\n`,
      // arguments arrive as a second fragment on a later tool_calls delta
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"/tmp\\"}"}}]}}]}\n\n`,
      `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseStream(pieces), { status: 200 })));

    const events: { e: string; d: unknown }[] = [];
    await streamOpenAI({
      resolved,
      messages: [{ role: "user", text: "hi" }],
      tools: [{ name: "fs_list", description: "", input_schema: {} }],
      system: "sys",
      signal: new AbortController().signal,
      emit: (e, d) => events.push({ e, d }),
    });

    const text = events.filter((x) => x.e === "delta").map((x) => x.d).join("");
    expect(text).toBe("Hello");
    const toolUse = events.find((x) => x.e === "tool_use")?.d as { name: string; input: unknown };
    expect(toolUse.name).toBe("fs_list");
    expect(toolUse.input).toEqual({ path: "/tmp" }); // both argument fragments concatenated then parsed
    const done = events.find((x) => x.e === "done")?.d as { stopReason: string };
    expect(done.stopReason).toBe("tool_use"); // tool_calls → tool_use so the agent loop continues
  });

  it("preserves Chat Completions cache/reasoning usage details without adding them to total", async () => {
    const pieces = [`data: ${JSON.stringify({ usage: { prompt_tokens: 30, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens: 6, completion_tokens_details: { reasoning_tokens: 4 }, total_tokens: 36 }, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseStream(pieces), { status: 200 })));
    const events: { e: string; d: unknown }[] = [];
    await streamOpenAI({ resolved, messages: [{ role: "user", text: "hi" }], system: "sys", signal: new AbortController().signal, emit: (e, d) => events.push({ e, d }) });
    expect(events.find((x) => x.e === "done")?.d).toEqual({ stopReason: "end_turn", usage: {
      accountingMode: "inclusive-input-output-total", apiCalls: 1, inputTokens: 30, outputTokens: 6, totalTokens: 36, cacheReadTokens: 20, reasoningTokens: 4,
      detailCoverage: { cacheReadTokens: 1, reasoningTokens: 1 },
    } });
  });

  it("throws provider+status on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(
      streamOpenAI({
        resolved,
        messages: [{ role: "user", text: "hi" }],
        system: "sys",
        signal: new AbortController().signal,
        emit: () => {},
      }),
    ).rejects.toThrow(/openai HTTP 401/);
  });
});
