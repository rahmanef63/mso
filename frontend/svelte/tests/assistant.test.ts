import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, readModels, streamAssistant } from "../src/lib/assistant/assistant-api.ts";
import { createAssistantController, type AssistantState } from "../src/lib/assistant/assistant-controller.ts";

const signal = new AbortController().signal;
const enc = new TextEncoder();

function sseResponse(chunks: string[], status = 200, contentType = "text/event-stream; charset=utf-8"): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
        controller.close();
      },
    }),
    { status, headers: { "Content-Type": contentType } },
  );
}

test("readModels validates real /api/models payloads, bridge credentials, and fails closed", async () => {
  const seen: Array<{ url: string; creds: unknown; cache: unknown }> = [];
  const bridge = { surface: "tauri-desktop" as const, apiBaseOrigin: "http://127.0.0.1:3000" };
  const models = await readModels(signal, async (input, init) => {
    seen.push({ url: String(input), creds: init?.credentials, cache: init?.cache });
    return Response.json({
      models: [
        { ref: "anthropic/claude-sonnet", provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet", reasoning: true, free: false },
        { id: "gpt-4o-mini", provider: "openai", name: "GPT-4o mini" },
      ],
    });
  }, bridge);
  assert.deepEqual(seen[0], { url: "http://127.0.0.1:3000/api/models", creds: "include", cache: "no-store" });
  assert.equal(models[0].ref, "anthropic/claude-sonnet");
  assert.equal(models[1].ref, "openai/gpt-4o-mini");

  await assert.rejects(readModels(signal, async () => Response.json({ models: [{ id: "" }] })), /models response is invalid/);
  await assert.rejects(
    readModels(signal, async () => new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } })),
    /API is unavailable/,
  );
  await assert.rejects(
    readModels(signal, async () => Response.json({ error: "secret stack trace" }, { status: 500 })),
    (err: unknown) => err instanceof ApiError && err.status === 500 && !err.message.includes("secret stack"),
  );
});

test("streamAssistant parses split SSE frames (delta, text, reasoning, done, error) and fails closed", async () => {
  const reqs: Array<{ url: string; body: unknown }> = [];
  const text: string[] = [], reasoning: string[] = [], done: Array<string | null> = [], errors: string[] = [];

  await streamAssistant(
    { messages: [{ role: "user", text: "Check CPU" }], model: "anthropic/claude-sonnet" },
    { onText: (c) => text.push(c), onReasoning: (r) => reasoning.push(r), onDone: (d) => done.push(d.stopReason), onError: (e) => errors.push(e) },
    signal,
    async (input, init) => {
      reqs.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return sseResponse([
        "event: reas", 'oning\ndata: "Checking ', 'stats"\n\nevent: delta\ndata: "CPU ',
        'is 12%"\r\n\r\ndata: {"type":"text","text":" ok"}\n\n', 'event: done\ndata: {"stopReason":"end_turn"}\n\n',
      ]);
    },
  );
  assert.equal(reqs[0].url, "/api/assistant");
  assert.deepEqual(reqs[0].body, { messages: [{ role: "user", text: "Check CPU" }], model: "anthropic/claude-sonnet" });
  assert.equal(reasoning.join(""), "Checking stats");
  assert.equal(text.join(""), "CPU is 12% ok");
  assert.deepEqual(done, ["end_turn"]);
  assert.equal(errors.length, 0);

  const errList: string[] = [];
  let doneAfterErr = 0;
  await streamAssistant(
    { messages: [{ role: "user", text: "hi" }] },
    { onText: () => {}, onDone: () => { doneAfterErr++; }, onError: (m) => errList.push(m) },
    signal,
    async () => sseResponse(['event: error\ndata: "secret provider stack trace"\n\n']),
  );
  assert.equal(errList.length, 1);
  assert.ok(!errList[0].includes("secret provider"));
  assert.equal(doneAfterErr, 0);

  await assert.rejects(
    streamAssistant({ messages: [{ role: "user", text: "hi" }] }, { onText: () => {} }, signal, async () =>
      new Response("<html>proxy</html>", { headers: { "Content-Type": "text/html" } }),
    ),
    /API is unavailable/,
  );
  await assert.rejects(
    streamAssistant({ messages: [{ role: "user", text: "hi" }] }, { onText: () => {} }, signal, async () =>
      Response.json({ error: "secret internal detail" }, { status: 500 }),
    ),
    (err: unknown) => err instanceof ApiError && err.status === 500 && !err.message.includes("secret internal"),
  );
});

test("assistant-controller supports loadModels, stopStreaming abort, newChat race safety, and retryLast", async () => {
  const states: AssistantState[] = [];
  let resolveLateFetch: ((res: Response) => void) | undefined;
  let abortedCount = 0, callNum = 0;

  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === "/api/models") {
      return Response.json({ models: [{ ref: "openai/gpt-4o", provider: "openai", id: "gpt-4o", name: "GPT-4o" }] });
    }
    callNum++;
    if (callNum === 1) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(enc.encode('event: delta\ndata: "Run 1"\n\n'));
            init?.signal?.addEventListener("abort", () => { abortedCount++; });
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    if (callNum === 2) return new Promise<Response>((resolve) => { resolveLateFetch = resolve; });
    if (callNum === 3) return Response.json({ error: "rate_limited" }, { status: 429 });
    return sseResponse(['event: reasoning\ndata: "plan"\n\nevent: delta\ndata: "Recovered"\n\nevent: done\ndata: {"stopReason":"end_turn"}\n\n']);
  };

  const ctrl = createAssistantController((s) => states.push(s), { fetcher });
  await ctrl.loadModels();
  assert.equal(ctrl.getState().selectedModel, "openai/gpt-4o");

  const first = ctrl.sendMessage("Long task");
  await ctrl.sendMessage("Duplicate ignored while streaming");
  assert.equal(callNum, 1);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(ctrl.getState().messages.at(-1)?.text, "Run 1");
  ctrl.stopStreaming();
  await first;
  assert.equal(abortedCount, 1);
  assert.equal(ctrl.getState().streaming, false);

  const second = ctrl.sendMessage("Race test");
  ctrl.newChat();
  resolveLateFetch?.(sseResponse(['event: delta\ndata: "STALE"\n\n']));
  await second;
  assert.equal(ctrl.getState().messages.length, 0);

  await ctrl.sendMessage("Retry me");
  assert.match(ctrl.getState().error ?? "", /Too many assistant requests/);
  await ctrl.retryLast();
  assert.equal(ctrl.getState().error, null);
  assert.equal(ctrl.getState().messages[1].reasoning, "plan");
  assert.equal(ctrl.getState().messages[1].text, "Recovered");

  const countBeforeDispose = states.length;
  ctrl.dispose();
  ctrl.newChat();
  assert.equal(states.length, countBeforeDispose);
});
