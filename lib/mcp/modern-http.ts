import { MCP_PROTOCOL_LATEST, MCP_PROTOCOLS } from "./protocol";
import type { RpcRequest } from "./dispatch-types";
const VERSION = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
export function decodeMcpHeader(value: string | null): string | null {
  if (value === null || !value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  const data = value.slice(9, -2);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(data, "base64")); } catch { return null; }
}
export function validateMcpRequest(req: Request, body: unknown): { modern: boolean; error?: Record<string, unknown> } {
  const rpc = object(body) ? body as RpcRequest : {};
  const fail = (code: number, message: string, data?: unknown) => ({ modern: false, error: { jsonrpc: "2.0", id: rpc.id ?? null, error: { code, message, ...(data ? { data } : {}) } } });
  if (!object(body) || (rpc.jsonrpc !== undefined && rpc.jsonrpc !== "2.0") || typeof rpc.method !== "string" || !rpc.method ||
    rpc.params !== undefined && !object(rpc.params) || rpc.id !== undefined && rpc.id !== null && !["number", "string"].includes(typeof rpc.id)) return fail(-32600, "invalid JSON-RPC request");
  if (rpc.method === "tools/call" && rpc.params?.arguments !== undefined && !object(rpc.params.arguments)) return fail(-32602, "tool arguments must be an object");
  const header = req.headers.get("MCP-Protocol-Version"), meta = rpc.params?._meta;
  const version = object(meta) ? meta[VERSION] : undefined;
  const modern = header === MCP_PROTOCOL_LATEST || version === MCP_PROTOCOL_LATEST;
  if (header && !(MCP_PROTOCOLS as readonly string[]).includes(header) && rpc.method !== "initialize") return fail(-32022, "unsupported MCP protocol version", { supported: [...MCP_PROTOCOLS], requested: header });
  if (version !== undefined && !(MCP_PROTOCOLS as readonly unknown[]).includes(version)) return fail(-32022, "unsupported MCP protocol version", { supported: [...MCP_PROTOCOLS], requested: version });
  if (!modern) return { modern: false };
  if (rpc.jsonrpc !== "2.0" || typeof version !== "string" || !object(meta?.[CAPABILITIES])) return fail(-32602, "modern requests require protocolVersion and clientCapabilities in params._meta");
  if (version !== header || req.headers.get("Mcp-Method") !== rpc.method) return fail(-32020, "MCP protocol/method header does not match the request body");
  const name = rpc.method === "resources/read" ? rpc.params?.uri : ["tools/call", "prompts/get"].includes(rpc.method) ? rpc.params?.name : undefined;
  if (["tools/call", "resources/read", "prompts/get"].includes(rpc.method) && (typeof name !== "string" || decodeMcpHeader(req.headers.get("Mcp-Name")) !== name)) return fail(-32020, "Mcp-Name header does not match the request body");
  return { modern: true };
}
export function modernMcpResult(value: Record<string, unknown>, serverVersion: string) {
  if (!object(value.result)) return value;
  return { ...value, result: { ...value.result, resultType: "complete", _meta: { ...(object(value.result._meta) ? value.result._meta : {}), "io.modelcontextprotocol/serverInfo": { name: "mso", version: serverVersion } } } };
}
