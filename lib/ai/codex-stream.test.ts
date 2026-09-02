import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { streamCodex } from "./codex-stream";
import type { OaMsg, OaTool } from "./openai-stream";

// Regression suite for the branch that used to declare itself "chat-only". It was
// not: the ChatGPT Codex backend takes tools over the Responses API, our request
// simply never sent them — so the UI advertised a catalog the model never saw.

const realFetch = globalThis.fetch;
beforeEach(() => {
  // Most tests exercise host function tools in isolation. Provider built-ins have
  // their own cases below, including the real default when the env is absent.
  vi.stubEnv("OS_CODEX_BUILTIN_TOOLS", "");
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

type SentBody = { tools?: { type: string; name?: string; function?: unknown; input_schema?: unknown }[]; input?: Record<string, unknown>[]; store?: unknown };

function capture(body: Response) {
  const calls: RequestInit[] = [];
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    calls.push(init);
    return Promise.resolve(body);
  }) as unknown as typeof fetch;
  return (): SentBody => JSON.parse(String(calls[0]?.body ?? "{}")) as SentBody;
}

const run = async (o: Partial<Parameters<typeof streamCodex>[0]> = {}) => {
  const events: [string, unknown][] = [];
  await streamCodex({
    bundle: { access: "t", accountId: "a" } as never,
    model: "gpt-5",
    messages: [{ role: "user", text: "hi" }],
    system: "sys",
    signal: new AbortController().signal,
    emit: (e, d) => events.push([e, d]),
    ...o,
  });
  return events;
};

const TOOL: OaTool = {
  name: "fs.list",
  description: "List a directory",
  input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

describe("tool declaration", () => {
  it("sends tools in the FLAT Responses shape, not Anthropic's or chat-completions'", async () => {
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run({ tools: [TOOL] });
    const body = sent();
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "fs_list", // dots are illegal on the wire — see the rename test below
        description: "List a directory",
        strict: false,
        parameters: TOOL.input_schema,
      },
    ]);
    // The two shapes that are NOT this, and each produce an opaque 400.
    expect(body.tools?.[0].function).toBeUndefined();
    expect(body.tools?.[0].input_schema).toBeUndefined();
  });

  it("underscores a dotted tool name — the API rejects dots outright", async () => {
    // Live 400: "Invalid 'tools[0].name': Expected a string that matches the
    // pattern '^[a-zA-Z0-9_-]+$'". Our catalog is dot.case and Anthropic accepts
    // it, so this only ever surfaces against the real backend — every mocked test
    // passed with the dots still in place.
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run({ tools: [TOOL] });
    expect(sent().tools?.[0].name).toBe("fs_list");
  });

  it("underscores the replayed call name too, or the turn 400s", async () => {
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run({
      tools: [TOOL],
      messages: [
        { role: "user", text: "go" },
        { role: "assistant", toolUses: [{ id: "c1", name: "fs.list", input: {} }] },
        { role: "tool", results: [{ id: "c1", content: "ok" }] },
      ],
    });
    const fc = (sent().input ?? []).find((i) => i.type === "function_call");
    expect(fc?.name).toBe("fs_list");
  });

  it("omits `tools` entirely when there are none — an empty array is not the same", async () => {
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run();
    expect(sent().tools).toBeUndefined();
  });

  it("always sends store:false, which the backend requires", async () => {
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run({ tools: [TOOL] });
    expect(sent().store).toBe(false);
  });
});

describe("tool round-trip", () => {
  it("replays a call as function_call and its result as function_call_output", async () => {
    // Both items, keyed by the same call_id. Dropping either 400s the next turn
    // with "No tool output found for function call".
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    const messages: OaMsg[] = [
      { role: "user", text: "list ~" },
      { role: "assistant", toolUses: [{ id: "call_1", name: "fs.list", input: { path: "~" } }] },
      { role: "tool", results: [{ id: "call_1", content: "a\nb" }] },
    ];
    await run({ messages, tools: [TOOL] });
    const input = sent().input as Record<string, unknown>[];
    expect(input).toContainEqual({
      type: "function_call",
      call_id: "call_1",
      name: "fs_list",
      arguments: JSON.stringify({ path: "~" }),
    });
    expect(input).toContainEqual({ type: "function_call_output", call_id: "call_1", output: "a\nb" });
  });
});

describe("reading calls back", () => {
  const call = (over: Record<string, unknown> = {}) => ({
    type: "function_call",
    status: "completed",
    call_id: "c1",
    name: "fs.list",
    arguments: '{"path":"~"}',
    ...over,
  });

  it("maps the wire name back to the catalog name", async () => {
    // The model answers with what we declared (fs_list); everything downstream —
    // the approval card, the executor, the audit trail — keys on fs.list.
    capture(sse({ type: "response.output_item.done", item: call({ name: "fs_list" }) }));
    const ev = await run({ tools: [TOOL] });
    expect(ev).toContainEqual(["tool_use", { id: "c1", name: "fs.list", input: { path: "~" } }]);
  });

  it("leaves an undeclared name alone rather than inventing a dot", async () => {
    capture(sse({ type: "response.output_item.done", item: call({ name: "mystery_tool" }) }));
    const ev = await run({ tools: [TOOL] });
    expect(ev).toContainEqual(["tool_use", { id: "c1", name: "mystery_tool", input: { path: "~" } }]);
  });

  it("emits tool_use and reports stopReason tool_use", async () => {
    capture(sse({ type: "response.output_item.done", item: call({ name: "fs_list" }) }));
    const ev = await run({ tools: [TOOL] });
    expect(ev).toContainEqual(["tool_use", { id: "c1", name: "fs.list", input: { path: "~" } }]);
    // The agent loop keys off this — end_turn here strands the result mid-task.
    expect(ev.at(-1)).toEqual(["done", { stopReason: "tool_use" }]);
  });

  it("does NOT emit the same call twice when response.completed repeats it", async () => {
    capture(
      sse(
        { type: "response.output_item.done", item: call() },
        { type: "response.completed", response: { output: [call()] } },
      ),
    );
    const ev = await run({ tools: [TOOL] });
    expect(ev.filter(([e]) => e === "tool_use")).toHaveLength(1);
  });

  it("ignores a partial item — its arguments are still streaming", async () => {
    capture(sse({ type: "response.output_item.done", item: call({ status: "in_progress", arguments: '{"pa' }) }));
    const ev = await run({ tools: [TOOL] });
    expect(ev.some(([e]) => e === "tool_use")).toBe(false);
    expect(ev.at(-1)).toEqual(["done", { stopReason: "end_turn" }]);
  });

  it("surfaces a call with malformed arguments rather than dropping the turn", async () => {
    capture(sse({ type: "response.output_item.done", item: call({ arguments: "{not json" }) }));
    const ev = await run({ tools: [TOOL] });
    expect(ev).toContainEqual(["tool_use", { id: "c1", name: "fs.list", input: {} }]);
  });

  it("preserves Responses cache/reasoning usage details with explicit inclusive semantics", async () => {
    capture(sse({ type: "response.completed", response: { output: [], usage: {
      input_tokens: 100, input_tokens_details: { cached_tokens: 60, cache_write_tokens: 5 },
      output_tokens: 20, output_tokens_details: { reasoning_tokens: 7 }, total_tokens: 120,
    } } }));
    const ev = await run();
    expect(ev.at(-1)).toEqual(["done", { stopReason: "end_turn", usage: {
      accountingMode: "inclusive-input-output-total", apiCalls: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120,
      cacheReadTokens: 60, cacheWriteTokens: 5, reasoningTokens: 7,
      detailCoverage: { cacheReadTokens: 1, cacheWriteTokens: 1, reasoningTokens: 1 },
    } }]);
  });

  it("still streams plain text with no tools declared", async () => {
    capture(sse({ type: "response.output_text.delta", delta: "hello" }));
    const ev = await run();
    expect(ev[0]).toEqual(["delta", "hello"]);
    expect(ev.at(-1)).toEqual(["done", { stopReason: "end_turn" }]);
  });
});

describe("provider-executed built-ins", () => {
  it("declares NO provider built-in when OS_CODEX_BUILTIN_TOOLS is absent", async () => {
    vi.unstubAllEnvs();
    delete process.env.OS_CODEX_BUILTIN_TOOLS;
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run({ tools: [TOOL] });
    expect((sent().tools ?? []).map((t) => t.type)).toEqual(["function"]);
  });

  it("accepts an explicit empty value to disable every provider built-in", async () => {
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run({ tools: [TOOL] });
    expect(sent().tools).toHaveLength(1);
  });

  it("uses an explicit built-in list by type alone and ignores unknown entries", async () => {
    vi.stubEnv("OS_CODEX_BUILTIN_TOOLS", "web_search, not_a_tool");
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run({ tools: [TOOL] });
    const tools = sent().tools ?? [];
    expect(tools.map((t) => t.type)).toEqual(["function", "web_search"]);
  });

  // MSO removed image generation everywhere. A GPT client already has its own, and
  // a second same-purpose tool is a choice the model gets wrong. The allowlist must
  // not quietly accept it back through the env knob.
  it("refuses image_generation even when the operator names it explicitly", async () => {
    vi.stubEnv("OS_CODEX_BUILTIN_TOOLS", "image_generation");
    const sent = capture(sse({ type: "response.completed", response: { output: [] } }));
    await run({ tools: [TOOL] });
    expect((sent().tools ?? []).map((t) => t.type)).toEqual(["function"]);
  });
});
