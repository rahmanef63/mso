import { a2aCredentialHeaders, getA2AOutboundCredential } from "./credentials";
import { validateStoredA2ACredentialBinding } from "./credential-scheme";
import { getOrCreateA2ALocalBearer, isOwnA2ALoopbackUrl } from "./local-auth";
import { a2aNetworkFetch, assertA2AUrl } from "./network";
export { assertA2AUrl } from "./network";
import type {
  A2AAgentInterface,
  A2ADiscoveredAgent,
  A2AStandardBinding,
} from "./types";

export const MAX_A2A_RESPONSE_BYTES = 1024 * 1024;
export const MAX_A2A_MESSAGE_BYTES = 24 * 1024;
export const A2A_TIMEOUT_MS = 20_000;
export const A2A_STREAM_TIMEOUT_MS = 5 * 60_000;
export const MAX_A2A_STREAM_EVENT_BYTES = 1024 * 1024;

export type A2AFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export const a2aTransport: A2AFetchLike = (input, init) =>
  a2aNetworkFetch(input, init);

export function a2aObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeA2ABinding(value: string): A2AStandardBinding | null {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized === "JSONRPC") return "JSONRPC";
  if (normalized === "HTTPJSON") return "HTTP+JSON";
  return null;
}

export async function boundedA2AJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_A2A_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`A2A response exceeds ${MAX_A2A_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_A2A_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`A2A response exceeds ${MAX_A2A_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(all);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("A2A endpoint returned invalid JSON");
  }
}

export async function fetchA2AJson(
  url: string,
  init: RequestInit,
  fetchImpl: A2AFetchLike,
): Promise<unknown> {
  const safe = assertA2AUrl(url).toString();
  const response = await fetchImpl(safe, {
    ...init,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(A2A_TIMEOUT_MS),
  });
  const body = await boundedA2AJson(response);
  if (!response.ok)
    throw new Error(`A2A endpoint returned HTTP ${response.status}`);
  return body;
}

export function assertA2AMessage(value: string): string {
  const message = String(value ?? "").trim();
  if (!message) throw new Error("A2A message must not be empty");
  if (Buffer.byteLength(message, "utf8") > MAX_A2A_MESSAGE_BYTES) {
    throw new Error(`A2A message exceeds ${MAX_A2A_MESSAGE_BYTES} bytes`);
  }
  return message;
}

export function a2aRestOperationUrl(
  iface: A2AAgentInterface,
  operation: string,
): string {
  const url = assertA2AUrl(iface.url);
  const base = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${base}${operation}`.replace(/\/{2,}/g, "/");
  url.search = "";
  return url.toString();
}

export function a2aRequestParams(
  iface: A2AAgentInterface,
  params: Record<string, unknown>,
): Record<string, unknown> {
  return iface.tenant ? { tenant: iface.tenant, ...params } : params;
}

export function a2aHeaders(
  iface: A2AAgentInterface,
  contentType: string,
  auth: Record<string, string> = {},
  accept = "application/a2a+json, application/json",
): HeadersInit {
  return {
    "content-type": contentType,
    accept,
    "a2a-version": iface.protocolVersion,
    ...auth,
  };
}

export async function a2aAuthorizationHeaders(
  target: A2ADiscoveredAgent,
): Promise<Record<string, string>> {
  const localScheme = target.card.securitySchemes?.msoLocal;
  if (
    isOwnA2ALoopbackUrl(target.selectedInterface.url) &&
    localScheme?.kind === "http" &&
    localScheme.scheme.toLowerCase() === "bearer" &&
    localScheme.bearerFormat === "MSO-LOCAL-A2A"
  ) {
    return { authorization: `Bearer ${await getOrCreateA2ALocalBearer()}` };
  }
  if (!target.card.requiresAuthentication && !target.credentialProfileId)
    return {};
  if (!target.credentialProfileId) {
    throw new Error(
      `A2A agent ${target.card.name} requires authentication; credential profiles are not configured yet`,
    );
  }
  const profile = await getA2AOutboundCredential(target.credentialProfileId);
  if (!profile)
    throw new Error(
      `A2A credential profile not found: ${target.credentialProfileId}`,
    );
  validateStoredA2ACredentialBinding(target.card, profile);
  return a2aCredentialHeaders(target.credentialProfileId);
}

export function a2aStreamSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(A2A_STREAM_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
