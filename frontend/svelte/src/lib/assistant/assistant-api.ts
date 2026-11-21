import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };
export type AssistantModel = {
  id: string; ref: string; provider: string; name: string;
  free?: boolean; reasoning?: boolean; agentReady?: boolean;
};
export type AssistantWireMessage = { role: "user" | "assistant"; text: string };
export type StreamAssistantInput = { messages: AssistantWireMessage[]; model?: string; system?: string };
export type StreamDonePayload = { stopReason: string | null };
export type StreamAssistantHandlers = {
  onText: (chunk: string) => void; onReasoning?: (chunk: string) => void;
  onDone?: (payload: StreamDonePayload) => void; onError?: (message: string) => void;
};
const MODELS_TIMEOUT_MS = 10_000, PROVIDER_RE = /^[a-z0-9._-]{1,40}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const KNOWN_CODES: Record<string, string> = {
  unauthorized: "Your session is unavailable or expired. Sign in to use Alfa Assistant.",
  owner_role_required: "Owner role is required to use Alfa Assistant.",
  rate_limited: "Too many assistant requests. Wait a moment and retry.",
  model_not_selected: "No AI model is selected on this host. Configure one in Settings.",
  oauth_refresh_failed: "Could not refresh provider sign-in. Reconnect it in Settings.",
  provider_unavailable: "The AI provider is temporarily unavailable. Retry shortly.",
  empty: "Assistant request could not be processed.",
  bad_request: "Assistant request could not be processed.",
};

function mapKnownCode(code: string): string | null {
  if (code.startsWith("no_api_key")) {
    const raw = code.split(":")[1] ?? "";
    return `No API key is configured for ${PROVIDER_RE.test(raw) ? raw : "the selected provider"}. Add one in Settings.`;
  }
  return KNOWN_CODES[code] ?? null;
}

function statusMessage(status: number, code?: string): string {
  const mapped = code ? mapKnownCode(code) : null;
  if (mapped) return mapped;
  if (status === 401) return KNOWN_CODES.unauthorized;
  if (status === 403) return KNOWN_CODES.owner_role_required;
  if (status === 429) return KNOWN_CODES.rate_limited;
  if (status === 501) return "No AI provider key is configured on this host. Add one in Settings.";
  if (status >= 500) return `MSO assistant service error (${status}). Retry shortly.`;
  return `MSO assistant API request failed (${status}).`;
}

function sanitizeStreamError(raw: unknown): string {
  const text = typeof raw === "string" ? raw
    : isRecord(raw) && typeof raw.code === "string" ? raw.code
    : isRecord(raw) && typeof raw.error === "string" ? raw.error
    : isRecord(raw) && typeof raw.message === "string" ? raw.message : "";
  const exact = mapKnownCode(text.trim());
  if (exact) return exact;
  if (/rate.?limit|\b429\b|quota/i.test(text)) return "Your AI provider is rate-limiting requests. Wait a moment and retry.";
  if (/overloaded|\b529\b|\b50[234]\b/i.test(text)) return "The AI provider is overloaded or unavailable. Retry shortly.";
  if (/timeout|timed out/i.test(text)) return "The AI provider timed out. Retry your request.";
  return "Assistant stream failed. Try again.";
}

function extractText(parsed: unknown, key?: "reasoning"): string | null {
  if (typeof parsed === "string") return parsed;
  if (!isRecord(parsed)) return null;
  if (key && typeof parsed[key] === "string") return parsed[key] as string;
  for (const field of ["text", "delta", "content"] as const) if (typeof parsed[field] === "string") return parsed[field] as string;
  return null;
}

function validateModel(raw: unknown): AssistantModel {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id.trim()) throw new ApiError("The MSO models response is invalid.", 502);
  const id = raw.id.trim();
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  const ref = typeof raw.ref === "string" && raw.ref.trim() ? raw.ref.trim() : provider ? `${provider}/${id}` : id;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  return {
    id, ref, provider, name,
    ...(typeof raw.free === "boolean" ? { free: raw.free } : {}),
    ...(typeof raw.reasoning === "boolean" ? { reasoning: raw.reasoning } : {}),
    ...(typeof raw.agentReady === "boolean" ? { agentReady: raw.agentReady } : {}),
  };
}

export async function readModels(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AssistantModel[]> {
  const response = await fetcher(resolveApiUrl("/api/models", bridge), {
    method: "GET", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(MODELS_TIMEOUT_MS)]),
    headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  if (!isJson) throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  let body: unknown;
  try { body = await response.json(); } catch { throw new ApiError("The MSO models response is invalid.", 502); }
  if (!isRecord(body) || !Array.isArray(body.models)) throw new ApiError("The MSO models response is invalid.", 502);
  return body.models.map(validateModel);
}

function dispatchSseBlock(block: string, handlers: StreamAssistantHandlers): "done" | "error" | "continue" {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    else if (line.startsWith("data:")) dataLines.push(line.startsWith("data: ") ? line.slice(6) : line.slice(5));
  }
  const rawData = dataLines.join("\n").trim();
  if (!rawData) return "continue";
  if (rawData === "[DONE]") { handlers.onDone?.({ stopReason: null }); return "done"; }
  let parsed: unknown;
  try { parsed = JSON.parse(rawData); } catch {
    if (event === "error") { handlers.onError?.(sanitizeStreamError("")); return "error"; }
    return "continue";
  }
  const kind = event === "message" && isRecord(parsed) && typeof parsed.type === "string" ? parsed.type : event;
  if (kind === "delta" || kind === "text") { const c = extractText(parsed); if (c) handlers.onText(c); }
  else if (kind === "reasoning") { const c = extractText(parsed, "reasoning"); if (c) handlers.onReasoning?.(c); }
  else if (kind === "done") {
    handlers.onDone?.({ stopReason: isRecord(parsed) && typeof parsed.stopReason === "string" ? parsed.stopReason : null });
    return "done";
  } else if (kind === "error") { handlers.onError?.(sanitizeStreamError(parsed)); return "error"; }
  return "continue";
}

export async function streamAssistant(
  input: StreamAssistantInput, handlers: StreamAssistantHandlers, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  const messages = input.messages.filter((m) => (m.role === "user" || m.role === "assistant") && m.text.trim().length > 0);
  if (!messages.length) throw new ApiError("Enter a message before sending.", 400);
  const payload: Record<string, unknown> = {
    messages: messages.map((m) => ({ role: m.role, text: m.text })),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.system?.trim() ? { system: input.system.trim() } : {}),
  };
  const response = await fetcher(resolveApiUrl("/api/assistant", bridge), {
    method: "POST", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store", signal,
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const ct = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!response.ok) {
    const body = ct.includes("application/json") ? await response.json().catch(() => null) : null;
    throw new ApiError(statusMessage(response.status, isRecord(body) && typeof body.error === "string" ? body.error : undefined), response.status);
  }
  if (!ct.includes("text/event-stream")) throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  if (!response.body) throw new ApiError("Assistant stream body is unavailable.", 502);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", finished = false, errored = false;
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (!finished && !errored && !signal.aborted) {
      const { done, value } = await reader.read();
      if (signal.aborted) break;
      buffer = (buffer + (done ? decoder.decode() : decoder.decode(value, { stream: true }))).replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = done ? "" : (blocks.pop() ?? "");
      for (const block of blocks) {
        const outcome = dispatchSseBlock(block, handlers);
        if (outcome === "done") { finished = true; break; }
        if (outcome === "error") { errored = true; break; }
      }
      if (done) break;
    }
    if (!signal.aborted && !finished && !errored) handlers.onDone?.({ stopReason: null });
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
