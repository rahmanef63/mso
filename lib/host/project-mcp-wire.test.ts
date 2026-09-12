import { describe, expect, it } from "vitest";
import { readMcpResponse } from "./project-mcp-wire";

describe("MCP HTTP framing", () => {
  it("handles split UTF-8, CRLF, notifications, unrelated IDs and an open SSE stream", async () => {
    const body = new TextEncoder().encode('data: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: {"id":2,"result":{}}\r\n\r\ndata: {"id":3,"result":{"text":"😀"}}\r\n\r\n');
    let offset = 0, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { if (offset < body.length) controller.enqueue(body.slice(offset, ++offset)); },
      cancel() { cancelled = true; },
    });
    expect(await readMcpResponse(new Response(stream, { headers: { "content-type": "text/event-stream" } }), 3)).toEqual({ id: 3, result: { text: "😀" } });
    expect(cancelled).toBe(true);
  });
  it("rejects mismatched IDs and excessive responses", async () => {
    await expect(readMcpResponse(new Response('{"id":2,"result":{}}'), 1)).rejects.toThrow("id mismatch");
    await expect(readMcpResponse(new Response("x".repeat(2 * 1024 * 1024 + 1)), 1)).rejects.toThrow("exceeded limit");
  });
});
