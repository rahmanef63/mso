import { authenticateA2AInboundToken } from "./credentials";
import { authenticateA2ALocalBearer } from "./local-auth";
import type { A2AInboundTokenSummary } from "./types";
import type { A2AMessage } from "./tasks";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MESSAGE_BYTES = 24 * 1024;
export const A2A_TERMINAL_STATES = new Set([
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
]);

export type A2ARpcId = string | number | null;
export type A2ARpcBody = {
  jsonrpc?: string;
  id?: A2ARpcId;
  method?: string;
  params?: Record<string, unknown>;
};

export function a2aObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function a2aRpcOk(id: A2ARpcId, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function a2aRpcError(
  id: A2ARpcId,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

export function a2aJson(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

export function a2aUnauthorized() {
  return a2aJson({ error: "unauthorized" }, 401, {
    "www-authenticate": 'Bearer realm="mso-a2a"',
  });
}

export async function readA2ARpcBody(req: Request): Promise<A2ARpcBody> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES)
    throw new Error("request_too_large");
  if (!req.body) throw new Error("invalid_request");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return a2aObject(JSON.parse(new TextDecoder().decode(bytes))) as A2ARpcBody;
  } catch {
    throw new Error("invalid_json");
  }
}

export type A2AAuthenticatedProfile = A2AInboundTokenSummary & {
  local?: boolean;
};

export async function authenticateA2ARequest(
  req: Request,
): Promise<A2AAuthenticatedProfile | null> {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  if (await authenticateA2ALocalBearer(match[1], req.url)) {
    return {
      id: "local-loopback",
      label: "local-loopback",
      scope: "exec",
      createdAt: "local",
      updatedAt: "local",
      local: true,
    };
  }
  return authenticateA2AInboundToken(match[1]);
}

export function parseA2ATextMessage(params: Record<string, unknown>): {
  prompt: string;
  message: A2AMessage;
  returnImmediately: boolean;
} {
  const raw = a2aObject(params.message);
  if (String(raw.role || "") !== "ROLE_USER")
    throw new Error("message_role_not_supported");
  const messageId = String(raw.messageId || "").trim();
  if (!messageId || messageId.length > 200)
    throw new Error("message_id_required");
  if (!Array.isArray(raw.parts) || !raw.parts.length)
    throw new Error("message_parts_required");
  const texts: string[] = [];
  for (const partValue of raw.parts.slice(0, 100)) {
    const part = a2aObject(partValue);
    const text = typeof part.text === "string" ? part.text : null;
    const mediaType =
      typeof part.mediaType === "string" ? part.mediaType : "text/plain";
    if (text == null || (mediaType && mediaType !== "text/plain"))
      throw new Error("content_type_not_supported");
    if (text.trim()) texts.push(text);
  }
  const prompt = texts.join("\n").trim();
  if (!prompt) throw new Error("message_text_required");
  if (Buffer.byteLength(prompt, "utf8") > MAX_MESSAGE_BYTES)
    throw new Error("message_too_large");
  const configuration = a2aObject(params.configuration);
  return {
    prompt,
    message: {
      messageId,
      role: "ROLE_USER",
      parts: [{ text: prompt, mediaType: "text/plain" }],
      ...(typeof raw.contextId === "string" && raw.contextId.trim()
        ? { contextId: raw.contextId.trim().slice(0, 200) }
        : {}),
      ...(typeof raw.taskId === "string" && raw.taskId.trim()
        ? { taskId: raw.taskId.trim().slice(0, 200) }
        : {}),
    },
    returnImmediately: configuration.returnImmediately === true,
  };
}

export function a2aTaskError(id: A2ARpcId, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|different principal/i.test(message))
    return a2aRpcError(id, -32001, "Task not found");
  if (/terminal|already working/i.test(message))
    return a2aRpcError(id, -32004, "Unsupported operation");
  if (/content_type/i.test(message))
    return a2aRpcError(id, -32005, "Content type not supported");
  if (/message_|contextId|request_too_large|page_token/i.test(message))
    return a2aRpcError(id, -32602, "Invalid params", message.slice(0, 160));
  return a2aRpcError(id, -32603, "Internal error");
}
