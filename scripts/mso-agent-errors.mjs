const SECRET_TEXT = /((?:api[_-]?key|token|secret|password|passwd|credential|authorization|cookie)\s*[=:]\s*)[^\s,;]+|\bBearer\s+[^\s,;]+/gi;

function safeOneLine(value, max = 180) {
  const clean = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const redacted = clean.replace(SECRET_TEXT, (match, prefix) => prefix ? `${prefix}[redacted]` : "Bearer [redacted]");
  return Array.from(redacted).length <= max ? redacted : `${Array.from(redacted).slice(0, max - 1).join("")}…`;
}

export class AgentApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number|null, path?: string, method?: string, requestDispatched?: boolean, cause?: unknown }} [meta]
   */
  constructor(message, { status = null, path = "", method = "GET", requestDispatched = false, cause = undefined } = {}) {
    super(safeOneLine(message || (status ? `HTTP ${status}` : "API request failed")));
    this.name = "AgentApiError";
    this.status = status === null || status === undefined || status === "" ? null : (Number.isFinite(Number(status)) ? Number(status) : null);
    this.path = String(path || "").slice(0, 240);
    this.method = String(method || "GET").toUpperCase();
    this.requestDispatched = requestDispatched === true;
    if (cause) this.cause = cause;
  }
}

export class AgentMutationUncertainError extends Error {
  constructor(toolName, apiError) {
    super(`delivery outcome is uncertain for ${String(toolName || "mutation")}; MSO will not retry it automatically`);
    this.name = "AgentMutationUncertainError";
    this.toolName = String(toolName || "mutation");
    this.apiError = apiError;
    this.mutationUncertain = true;
  }
}

export function isAgentApiError(error) {
  return error instanceof AgentApiError || error?.name === "AgentApiError";
}

export function isRecoverableInteractionError(error) {
  if (error?.name === "AbortError") return false;
  return isAgentApiError(error) || error?.name === "AgentMutationUncertainError" || error?.mutationUncertain === true;
}

export function safeErrorSummary(error) {
  if (error?.name === "AgentMutationUncertainError") {
    const inner = error.apiError;
    return safeOneLine(`${error.message}${inner?.status ? ` · HTTP ${inner.status}` : ""}`);
  }
  if (isAgentApiError(error)) return safeOneLine(`${error.message}${error.status && !String(error.message).includes(String(error.status)) ? ` · HTTP ${error.status}` : ""}`);
  return safeOneLine(error instanceof Error ? error.message : String(error || "interaction failed"));
}

function latestCompletedMutation(calls = []) {
  return [...(Array.isArray(calls) ? calls : [])].reverse().find((call) => call?.ok === true && ["write", "exec"].includes(call?.scope)) || null;
}

export function recoverableTurnState(error, journal = {}) {
  const calls = Array.isArray(journal?.calls) ? journal.calls : [];
  const completed = latestCompletedMutation(calls);
  const uncertainTool = error?.name === "AgentMutationUncertainError" ? String(error.toolName || "mutation") : null;
  let mutationState = "not_started";
  if (uncertainTool) mutationState = "uncertain";
  else if (completed) mutationState = "completed";
  else if (isAgentApiError(error) && error.path !== "/api/assistant" && !["GET", "HEAD"].includes(String(error.method || "GET").toUpperCase())) mutationState = "uncertain";
  return {
    summary: safeErrorSummary(error),
    status: error?.apiError?.status ?? error?.status ?? null,
    mutationState,
    mutationTool: uncertainTool || completed?.name || null,
    requestDispatched: error?.apiError?.requestDispatched ?? error?.requestDispatched ?? false,
    action: mutationState === "uncertain"
      ? "Do not retry automatically. Verify the target state first, then retry only if needed."
      : mutationState === "completed"
        ? "The previous mutation completed. Continue from the result; do not repeat it just because this later request failed."
        : "Nothing mutating is known to have run. Continue or retry the failed read/assistant step when ready.",
  };
}

export function recoverableErrorLines(state) {
  const rows = [safeOneLine(state?.summary || "recoverable interaction error")];
  if (state?.mutationState === "completed") rows.push(`mutation: completed${state.mutationTool ? ` · ${state.mutationTool}` : ""}`);
  else if (state?.mutationState === "uncertain") rows.push(`mutation: uncertain${state.mutationTool ? ` · ${state.mutationTool}` : ""}`);
  else rows.push("mutation: not started in this failed step");
  rows.push(safeOneLine(state?.action || "Continue when ready."));
  return rows;
}

export function recoverableHistoryRow(state) {
  return {
    role: "recoverable_error",
    text: safeOneLine(state?.summary || "recoverable interaction error", 500),
    mutationState: state?.mutationState || "not_started",
    mutationTool: state?.mutationTool || undefined,
    status: state?.status || undefined,
    createdAt: new Date().toISOString(),
  };
}
