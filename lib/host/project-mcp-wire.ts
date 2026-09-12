// Bounded JSON/SSE framing shared by project HTTP MCP calls.
export type Rpc = { jsonrpc?: string; id?: string | number | null; result?: unknown; error?: { code?: number; message?: string } };
const MAX_WIRE_BYTES = 2 * 1024 * 1024;

function eventMessage(block: string): Rpc | undefined {
  const data = block.split(/\r\n|\r|\n/).filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).replace(/^ /, "")).join("\n");
  return data ? JSON.parse(data) as Rpc : undefined;
}

/** Stop as soon as our response arrives; an SSE connection need not close. */
export async function readMcpResponse(response: Response, expectedId?: string | number): Promise<Rpc> {
  if (!response.body) return {};
  const sse = (response.headers.get("content-type") ?? "").includes("text/event-stream");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        bytes += value.byteLength;
        if (bytes > MAX_WIRE_BYTES) throw new Error("project MCP HTTP response exceeded limit");
        buffer += decoder.decode(value, { stream: true });
      }
      if (done) buffer += decoder.decode();
      if (sse) {
        let separator: RegExpExecArray | null;
        while ((separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
          const block = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);
          const message = eventMessage(block);
          if (message && expectedId !== undefined && message.id === expectedId) return message;
        }
      }
      if (!done) continue;
      if (sse) throw new Error("project MCP SSE response contained no matching JSON-RPC result");
      if (!buffer.trim() && expectedId === undefined) return {};
      const message = JSON.parse(buffer) as Rpc;
      if (expectedId !== undefined && message.id !== expectedId) throw new Error("project MCP response id mismatch");
      return message;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
