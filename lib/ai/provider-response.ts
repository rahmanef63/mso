export const PROVIDER_TIMEOUT_MS = 120_000;
export const PROVIDER_MAX_BYTES = 8 * 1024 * 1024;

/** Read only a small error prefix and release the provider connection. */
export async function providerErrorText(response: Response, signal: AbortSignal, limit = 300): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (size < limit && !signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, limit - size); chunks.push(part); size += part.length;
    }
    return new TextDecoder().decode(Buffer.concat(chunks, size));
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}

/** SDKs may buffer tool arguments before emitting them; cap the wire too. */
export function boundedProviderFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (!response.body) return response;
    let bytes = 0;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > PROVIDER_MAX_BYTES) throw new Error("provider response exceeds byte budget");
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
