import { randomUUID } from "node:crypto";
import { assertSafeUrl, safeProviderFetch } from "@/lib/host/ssrf";
import type { A2AAgentCard, A2AAgentInterface, A2ADiscoveredAgent, A2ASendOptions, A2AStandardBinding } from "./types";

export const MAX_A2A_RESPONSE_BYTES = 1024 * 1024;
export const MAX_A2A_MESSAGE_BYTES = 24 * 1024;
export const A2A_TIMEOUT_MS = 20_000;

function assertA2AUrl(raw: string | URL): URL {
  const url = assertSafeUrl(String(raw));
  if (url.protocol !== "https:") throw new Error("A2A endpoints must use HTTPS");
  return url;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const transport: FetchLike = (input, init) => safeProviderFetch(input, init);

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, field: string, max = 500): string {
  const out = typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim() : "";
  if (!out) throw new Error(`A2A Agent Card is missing ${field}`);
  return [...out].slice(0, max).join("");
}
function strings(value: unknown, max = 100): string[] {
  return Array.isArray(value) ? value.filter((row): row is string => typeof row === "string" && Boolean(row.trim()))
    .map((row) => row.trim().slice(0, 200)).slice(0, max) : [];
}
function normalizeBinding(value: string): A2AStandardBinding | null {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized === "JSONRPC") return "JSONRPC";
  if (normalized === "HTTPJSON") return "HTTP+JSON";
  return null;
}
function supportsV1(value: string): boolean { return /^1(?:\.|$)/.test(value.trim()); }

export function a2aAgentCardUrl(source: string): string {
  const url = assertA2AUrl(source);
  if (!/\.json$/i.test(url.pathname)) {
    url.pathname = "/.well-known/agent-card.json";
    url.search = "";
  }
  return url.toString();
}

function normalizeInterface(value: unknown): A2AAgentInterface {
  const row = obj(value);
  const url = assertA2AUrl(text(row.url, "supportedInterfaces[].url", 2048)).toString();
  return {
    url,
    protocolBinding: text(row.protocolBinding, "supportedInterfaces[].protocolBinding", 160),
    protocolVersion: text(row.protocolVersion, "supportedInterfaces[].protocolVersion", 40),
    ...(typeof row.tenant === "string" && row.tenant.trim() ? { tenant: row.tenant.trim().slice(0, 160) } : {}),
  };
}

export function normalizeA2AAgentCard(value: unknown): A2AAgentCard {
  const raw = obj(value);
  const interfaces = Array.isArray(raw.supportedInterfaces) ? raw.supportedInterfaces.map(normalizeInterface).slice(0, 20) : [];
  if (!interfaces.length) throw new Error("A2A Agent Card must declare supportedInterfaces");
  const capabilities = Object.fromEntries(Object.entries(obj(raw.capabilities))
    .filter(([, v]) => typeof v === "boolean").slice(0, 30)) as Record<string, boolean>;
  const requirementsRaw = Array.isArray(raw.securityRequirements) ? raw.securityRequirements
    : Array.isArray(raw.security) ? raw.security : [];
  // Agent Cards are public metadata, but a malicious peer could still stuff arbitrary
  // nested values into a security requirement. Persist only scheme NAMES; actual
  // credentials are always acquired/stored out of band and never copied from a card.
  const securityRequirements = requirementsRaw.slice(0, 20).map((entry) => {
    const row = obj(entry);
    return Object.fromEntries(Object.keys(row).filter((key) => /^[A-Za-z0-9._-]{1,120}$/.test(key)).slice(0, 20).map((key) => [key, {}]));
  });
  const requiresAuthentication = securityRequirements.length > 0 && !securityRequirements.some((row) => Object.keys(row).length === 0);
  const skills = (Array.isArray(raw.skills) ? raw.skills : []).slice(0, 200).map((entry) => {
    const row = obj(entry);
    return {
      id: text(row.id, "skills[].id", 160), name: text(row.name, "skills[].name", 160),
      description: text(row.description, "skills[].description", 600), tags: strings(row.tags, 30),
      inputModes: strings(row.inputModes, 30), outputModes: strings(row.outputModes, 30),
    };
  });
  return {
    name: text(raw.name, "name", 160), description: text(raw.description, "description", 1000), version: text(raw.version, "version", 80),
    supportedInterfaces: interfaces, capabilities,
    defaultInputModes: strings(raw.defaultInputModes, 30), defaultOutputModes: strings(raw.defaultOutputModes, 30), skills,
    securityRequirements, securitySchemeNames: Object.keys(obj(raw.securitySchemes)).slice(0, 30), requiresAuthentication,
  };
}

export function selectA2AInterface(card: A2AAgentCard): A2AAgentInterface {
  const selected = card.supportedInterfaces.find((row) => supportsV1(row.protocolVersion) && normalizeBinding(row.protocolBinding));
  if (!selected) {
    const advertised = card.supportedInterfaces.map((row) => `${row.protocolBinding}@${row.protocolVersion}`).join(", ");
    throw new Error(`A2A agent has no supported v1 JSONRPC or HTTP+JSON interface${advertised ? `; advertised: ${advertised}` : ""}`);
  }
  return selected;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_A2A_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`A2A response exceeds ${MAX_A2A_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return null;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break; if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_A2A_RESPONSE_BYTES) { await reader.cancel().catch(() => undefined); throw new Error(`A2A response exceeds ${MAX_A2A_RESPONSE_BYTES} bytes`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(all);
  try { return raw ? JSON.parse(raw) : null; } catch { throw new Error("A2A endpoint returned invalid JSON"); }
}

async function fetchJson(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<unknown> {
  const safe = assertA2AUrl(url).toString();
  const response = await fetchImpl(safe, { ...init, redirect: "error", signal: init.signal ?? AbortSignal.timeout(A2A_TIMEOUT_MS) });
  const body = await boundedJson(response);
  if (!response.ok) throw new Error(`A2A endpoint returned HTTP ${response.status}`);
  return body;
}

export async function discoverA2AAgent(source: string, fetchImpl: FetchLike = transport): Promise<A2ADiscoveredAgent> {
  const cardUrl = a2aAgentCardUrl(source);
  const raw = await fetchJson(cardUrl, { headers: { accept: "application/a2a+json, application/json" } }, fetchImpl);
  const card = normalizeA2AAgentCard(raw);
  return { cardUrl, card, selectedInterface: selectA2AInterface(card) };
}

function assertAnonymous(card: A2AAgentCard): void {
  if (card.requiresAuthentication) {
    throw new Error(`A2A agent ${card.name} requires authentication; credential profiles are not configured yet`);
  }
}
function assertMessage(value: string): string {
  const message = String(value ?? "").trim(); if (!message) throw new Error("A2A message must not be empty");
  if (Buffer.byteLength(message, "utf8") > MAX_A2A_MESSAGE_BYTES) throw new Error(`A2A message exceeds ${MAX_A2A_MESSAGE_BYTES} bytes`);
  return message;
}
function restOperationUrl(iface: A2AAgentInterface, operation: string): string {
  const url = assertA2AUrl(iface.url); const base = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${base}${operation}`.replace(/\/{2,}/g, "/"); url.search = "";
  return url.toString();
}
function requestParams(iface: A2AAgentInterface, params: Record<string, unknown>): Record<string, unknown> {
  return iface.tenant ? { tenant: iface.tenant, ...params } : params;
}
function headers(iface: A2AAgentInterface, contentType: string): HeadersInit {
  return { "content-type": contentType, accept: "application/a2a+json, application/json", "a2a-version": iface.protocolVersion };
}

async function invoke(target: A2ADiscoveredAgent, method: "SendMessage" | "GetTask" | "CancelTask", params: Record<string, unknown>, fetchImpl: FetchLike): Promise<unknown> {
  assertAnonymous(target.card); const iface = target.selectedInterface; const binding = normalizeBinding(iface.protocolBinding);
  if (!binding) throw new Error(`unsupported A2A binding: ${iface.protocolBinding}`);
  const rpcParams = requestParams(iface, params);
  if (binding === "JSONRPC") {
    const rpcId = randomUUID();
    const response = obj(await fetchJson(iface.url, { method: "POST", headers: headers(iface, "application/json"), body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params: rpcParams }) }, fetchImpl));
    if (response.error) { const err = obj(response.error); throw new Error(`A2A ${method} failed: ${String(err.message || "JSON-RPC error")}`); }
    return response.result;
  }
  if (method === "GetTask") {
    const taskId = encodeURIComponent(String(params.id)); const url = new URL(restOperationUrl(iface, `tasks/${taskId}`));
    if (iface.tenant) url.searchParams.set("tenant", iface.tenant);
    if (params.historyLength !== undefined) url.searchParams.set("historyLength", String(params.historyLength));
    return fetchJson(url.toString(), { headers: headers(iface, "application/a2a+json") }, fetchImpl);
  }
  const path = method === "SendMessage" ? "message:send" : `tasks/${encodeURIComponent(String(params.id))}:cancel`;
  const body = method === "SendMessage"
    ? requestParams(iface, params)
    : { ...(iface.tenant ? { tenant: iface.tenant } : {}) };
  return fetchJson(restOperationUrl(iface, path), { method: "POST", headers: headers(iface, "application/a2a+json"), body: JSON.stringify(body) }, fetchImpl);
}

export async function sendA2AMessage(target: A2ADiscoveredAgent, message: string, options: A2ASendOptions = {}, fetchImpl: FetchLike = transport): Promise<unknown> {
  const content = assertMessage(message);
  const msg = { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text: content, mediaType: "text/plain" }],
    ...(options.contextId ? { contextId: options.contextId } : {}), ...(options.taskId ? { taskId: options.taskId } : {}) };
  const configuration = { acceptedOutputModes: target.card.defaultOutputModes.length ? target.card.defaultOutputModes.slice(0, 20) : ["text/plain", "application/json"],
    ...(options.historyLength !== undefined ? { historyLength: Math.max(0, Math.min(100, Math.trunc(options.historyLength))) } : {}),
    ...(options.returnImmediately !== undefined ? { returnImmediately: options.returnImmediately } : {}) };
  return invoke(target, "SendMessage", { message: msg, configuration, ...(options.metadata ? { metadata: options.metadata } : {}) }, fetchImpl);
}

export function getA2ATask(target: A2ADiscoveredAgent, taskId: string, historyLength = 10, fetchImpl: FetchLike = transport): Promise<unknown> {
  const id = String(taskId || "").trim(); if (!id) throw new Error("A2A task id is required");
  return invoke(target, "GetTask", { id, historyLength: Math.max(0, Math.min(100, Math.trunc(historyLength))) }, fetchImpl);
}
export function cancelA2ATask(target: A2ADiscoveredAgent, taskId: string, fetchImpl: FetchLike = transport): Promise<unknown> {
  const id = String(taskId || "").trim(); if (!id) throw new Error("A2A task id is required");
  return invoke(target, "CancelTask", { id }, fetchImpl);
}
