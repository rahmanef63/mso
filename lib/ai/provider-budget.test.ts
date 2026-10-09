import { afterEach, expect, it, vi } from "vitest";
import { streamOpenAI } from "./openai-stream";
import { boundedProviderFetch, providerErrorText, PROVIDER_MAX_BYTES, PROVIDER_TIMEOUT_MS } from "./provider-response";
const resolved = { baseUrl: "https://fixture.invalid/v1", apiKey: "synthetic", model: "fixture", provider: "fixture" };
afterEach(() => vi.restoreAllMocks());
function source(pieces: string[]) {
  const cancel = vi.fn(); let index = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (index < pieces.length) controller.enqueue(new TextEncoder().encode(pieces[index++])); else controller.close(); }, cancel });
  return { body, cancel };
}
const run = (body: ReadableStream<Uint8Array>, status = 200) => streamOpenAI({ resolved, messages: [], system: "fixture", signal: new AbortController().signal, emit: vi.fn(), fetchImpl: vi.fn(async () => new Response(body, { status })) });
it.each(["partial", "arguments", "text", "events", "calls", "bytes"])("cancels an excessive %s response before buffering more", async (kind) => {
  const sse = (delta: object) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
  const pieces = kind === "partial" ? ["data: " + "x".repeat(256 * 1024)]
    : kind === "arguments" ? Array.from({ length: 6 }, () => sse({ tool_calls: [{ index: 0, function: { arguments: "x".repeat(50 * 1024) } }] }))
    : kind === "text" ? Array.from({ length: 12 }, () => sse({ content: "x".repeat(100 * 1024) }))
    : kind === "events" ? ["\n".repeat(16_385)]
    : kind === "calls" ? Array.from({ length: 65 }, (_, index) => sse({ tool_calls: [{ index, id: String(index), function: { name: "fixture", arguments: "{}" } }] }))
    : Array.from({ length: 90 }, () => ":" + "x".repeat(100 * 1024) + "\n");
  const { body, cancel } = source([...pieces, "never consumed"]);
  await expect(run(body)).rejects.toThrow(/budget/);
  expect(cancel).toHaveBeenCalled();
});
it("reads only a bounded error prefix and cancels a never-ending error body", async () => {
  const cancel = vi.fn(), pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => controller.enqueue(new TextEncoder().encode("denied ".repeat(100))));
  const body = new ReadableStream({ pull, cancel });
  await expect(run(body, 401)).rejects.toThrow(/fixture HTTP 401/);
  expect(cancel).toHaveBeenCalled(); expect(pull.mock.calls.length).toBeLessThan(4);
});
it("enforces a server deadline while headers are withheld", async () => {
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => { expect(ms).toBe(PROVIDER_TIMEOUT_MS); return deadline.signal; });
  const fetchImpl: typeof fetch = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)); queueMicrotask(() => deadline.abort(new Error("provider deadline"))); }));
  await expect(streamOpenAI({ resolved, messages: [], system: "", signal: new AbortController().signal, emit: vi.fn(), fetchImpl })).rejects.toThrow("deadline");
});
it("cancels a stalled body when the server deadline elapses", async () => {
  const deadline = new AbortController(), cancel = vi.fn();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const body = new ReadableStream<Uint8Array>({ pull() { queueMicrotask(() => deadline.abort(new Error("provider deadline"))); }, cancel });
  await expect(run(body)).rejects.toThrow("deadline"); expect(cancel).toHaveBeenCalled();
});
it("bounds SDK response bodies and releases the upstream reader", async () => {
  const { body, cancel } = source(["x".repeat(PROVIDER_MAX_BYTES + 1), "unread"]);
  const response = await boundedProviderFetch(vi.fn(async () => new Response(body)))("https://fixture.invalid");
  await expect(response.text()).rejects.toThrow(/budget/);
  await new Promise(resolve => setTimeout(resolve, 0)); expect(cancel).toHaveBeenCalled();
});
it("connection-test error reads use the same bounded prefix", async () => {
  const { body, cancel } = source(["x".repeat(500), "unread"]);
  expect((await providerErrorText(new Response(body), new AbortController().signal, 140)).length).toBe(140);
  expect(cancel).toHaveBeenCalled();
});
