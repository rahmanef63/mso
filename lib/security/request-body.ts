/** Bounded readers for public ingress. Count actual bytes before decoding/parsing. */
export class RequestBodyError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "RequestBodyError"; }
}
export async function readRequestText(req: Request, maxBytes: number, timeoutMs = 5_000): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) throw new Error("invalid request body limit");
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new RequestBodyError(413, "request_too_large");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "", timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RequestBodyError(408, "request_timeout")), timeoutMs); });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new RequestBodyError(413, "request_too_large");
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error instanceof RequestBodyError ? error : new RequestBodyError(400, "invalid_request");
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export async function readRequestJson(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await readRequestText(req, maxBytes);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value as Record<string, unknown>;
  } catch { throw new RequestBodyError(400, "invalid_request"); }
}
