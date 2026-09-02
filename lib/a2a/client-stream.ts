import { randomUUID } from "node:crypto";
import type {
  A2ADiscoveredAgent,
  A2AStandardBinding,
  A2AStreamOptions,
} from "./types";
import {
  MAX_A2A_STREAM_EVENT_BYTES,
  a2aAuthorizationHeaders,
  a2aHeaders,
  a2aObject,
  a2aRequestParams,
  a2aRestOperationUrl,
  a2aStreamSignal,
  a2aTransport,
  assertA2AUrl,
  normalizeA2ABinding,
  type A2AFetchLike,
} from "./client-core";
import { a2aSendParams } from "./client-ops";

async function* a2aSseEvents(
  response: Response,
  binding: A2AStandardBinding,
): AsyncGenerator<unknown> {
  if (!response.ok || !response.body)
    throw new Error(`A2A streaming endpoint returned HTTP ${response.status}`);
  const type = response.headers.get("content-type")?.toLowerCase() || "";
  if (!type.includes("text/event-stream"))
    throw new Error("A2A streaming endpoint did not return text/event-stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (Buffer.byteLength(buffer, "utf8") > MAX_A2A_STREAM_EVENT_BYTES * 2)
        throw new Error("A2A stream event buffer exceeded safe limit");
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (Buffer.byteLength(data, "utf8") > MAX_A2A_STREAM_EVENT_BYTES)
          throw new Error(
            `A2A stream event exceeds ${MAX_A2A_STREAM_EVENT_BYTES} bytes`,
          );
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          throw new Error("A2A streaming endpoint returned invalid SSE JSON");
        }
        if (binding === "JSONRPC") {
          const envelope = a2aObject(parsed);
          if (envelope.error) {
            const error = a2aObject(envelope.error);
            throw new Error(
              `A2A SendStreamingMessage failed: ${String(error.message || "JSON-RPC error")}`,
            );
          }
          yield envelope.result;
        } else yield parsed;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function* sendA2AStreamingMessage(
  target: A2ADiscoveredAgent,
  message: string,
  options: A2AStreamOptions = {},
  fetchImpl: A2AFetchLike = a2aTransport,
): AsyncGenerator<unknown> {
  const auth = await a2aAuthorizationHeaders(target);
  const iface = target.selectedInterface;
  const binding = normalizeA2ABinding(iface.protocolBinding);
  if (!binding)
    throw new Error(`unsupported A2A binding: ${iface.protocolBinding}`);
  if (target.card.capabilities.streaming !== true)
    throw new Error(
      `A2A agent ${target.card.name} does not advertise streaming`,
    );
  const params = a2aRequestParams(
    iface,
    a2aSendParams(target, message, options),
  );
  const signal = a2aStreamSignal(options.signal);
  let response: Response;
  if (binding === "JSONRPC") {
    response = await fetchImpl(assertA2AUrl(iface.url).toString(), {
      method: "POST",
      redirect: "error",
      signal,
      headers: a2aHeaders(iface, "application/json", auth, "text/event-stream"),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "SendStreamingMessage",
        params,
      }),
    });
  } else {
    response = await fetchImpl(a2aRestOperationUrl(iface, "message:stream"), {
      method: "POST",
      redirect: "error",
      signal,
      headers: a2aHeaders(
        iface,
        "application/a2a+json",
        auth,
        "text/event-stream",
      ),
      body: JSON.stringify(params),
    });
  }
  yield* a2aSseEvents(response, binding);
}
