// The custom-provider Anthropic path must keep sending the headers that
// Anthropic-compatible gateways already accept. @anthropic-ai/sdk v1 sends the
// key as `Authorization: Bearer` and defaults `anthropic-version` to
// 2026-10-21, which breaks gateways that require `x-api-key` or pin the older
// API version. This test pins the compatibility override so a future SDK bump
// cannot silently drop it.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";

// The real guard refuses loopback by design (SSRF policy), so a loopback test
// server is only reachable when the guard itself is stubbed. Everything under
// test is the outbound header contract, not the network policy.
vi.mock("@/lib/host/ssrf", () => ({
  safeProviderFetch: (url: string | URL | Request, init?: RequestInit) => fetch(url as never, init),
}));

const { streamPreparedSelectedModel } = await import("./selected-model-stream");

function sse(res: import("node:http").ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("message_start", {
    type: "message_start",
    message: {
      id: "msg_1", type: "message", role: "assistant", model: "test", content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 },
    },
  });
  send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } });
  send("content_block_stop", { type: "content_block_stop", index: 0 });
  send("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } });
  send("message_stop", { type: "message_stop" });
  res.end();
}

describe("custom anthropic provider headers", () => {
  let server: Server;
  let baseUrl: string;
  let captured: Record<string, string | string[] | undefined> = {};

  beforeEach(async () => {
    captured = {};
    server = createServer((req, res) => {
      captured = req.headers;
      if (!req.headers["x-api-key"]) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "x-api-key required" } }));
        return;
      }
      if (req.headers["anthropic-version"] !== "2023-06-01") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "unsupported version" } }));
        return;
      }
      sse(res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends x-api-key and the pinned API version to a custom gateway", async () => {
    const deltas: string[] = [];
    const done: unknown[] = [];

    await streamPreparedSelectedModel({
      prepared: {
        kind: "anthropic",
        provider: "gateway",
        model: "gateway-model",
        customProvider: true,
        resolved: { provider: "gateway", model: "gateway-model", baseUrl, apiKey: "sk-test", protocol: "anthropic" },
      } as never,
      messages: [{ role: "user", text: "ping" }] as never,
      system: "sys",
      signal: new AbortController().signal,
      emit: (event: string, payload: unknown) => {
        if (event === "delta") deltas.push(String(payload));
        if (event === "done") done.push(payload);
      },
    });

    expect(captured["x-api-key"]).toBe("sk-test");
    expect(captured["anthropic-version"]).toBe("2023-06-01");
    expect(deltas).toEqual(["hi"]);
    expect(done).toHaveLength(1);
  });
});
