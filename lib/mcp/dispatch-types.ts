import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { McpToolProfile } from "./tool-contract";

export interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  _meta?: Record<string, unknown>;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
    uri?: string;
    cursor?: string;
    _meta?: Record<string, unknown>;
  };
}

export interface McpAgentContext {
  principal?: string;
  sessionId?: string;
  toolProfile?: McpToolProfile;
  allowedTools?: readonly string[];
  toolArgumentConstraints?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  capabilities?: CapabilityRuntime;
}

export type RpcId = string | number | null | undefined;
export const rpcOk = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
export const rpcFail = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
