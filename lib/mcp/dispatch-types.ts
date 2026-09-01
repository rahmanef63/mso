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
    _meta?: Record<string, unknown>;
  };
}

export interface McpAgentContext {
  principal?: string;
  sessionId?: string;
}

export type RpcId = string | number | null | undefined;

export const rpcOk = (id: RpcId, result: unknown) =>
  ({ jsonrpc: "2.0", id: id ?? null, result });
export const rpcFail = (id: RpcId, code: number, message: string) =>
  ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
