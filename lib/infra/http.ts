export const TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
export const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)+\.?$/;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type InfraResponse = { status: number; ok: boolean; body: unknown; text: string };

async function boundedText(res: Response): Promise<string> {
  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`provider response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel("provider response too large").catch(() => undefined);
        throw new Error(`provider response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
  fetchImpl: FetchLike = fetch,
): Promise<InfraResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
    const text = await boundedText(res);
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, ok: res.ok, body, text };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error(`request timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
