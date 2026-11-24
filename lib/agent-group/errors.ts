export class AgentGroupError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function agentGroupError(error: unknown): AgentGroupError {
  return error instanceof AgentGroupError ? error : new AgentGroupError("agent_group_operation_failed", 400);
}
