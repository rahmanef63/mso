import { SetupError, SETUP_MAX_BODY } from "./setup-capability";
export async function readSetupJson(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new SetupError("json_required", 415);
  if (Number(req.headers.get("content-length")) > SETUP_MAX_BODY) throw new SetupError("request_too_large", 413);
  const reader = req.body?.getReader(); if (!reader) throw new SetupError("invalid_request", 400);
  let text = "", bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const part = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SetupError("request_timeout", 408)), 5000); })]).finally(() => clearTimeout(timer));
      if (part.done) break;
      bytes += part.value.byteLength; if (bytes > SETUP_MAX_BODY) throw new SetupError("request_too_large", 413);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SetupError("invalid_request", 400);
    return value as Record<string, unknown>;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof SetupError ? error : new SetupError("invalid_request", 400);
  } finally { reader.releaseLock(); }
}
