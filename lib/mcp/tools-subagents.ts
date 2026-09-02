import { runSessionSubagent } from "@/lib/agent/subagent-runner";
import { allows, parseScope } from "./scope";
import { type McpTool, S, str } from "./tool-kit";

export const SUBAGENT_TOOLS: McpTool[] = [{
  name: "agent_subagent_run",
  description: "Spawn one foreground focused subagent inside the current durable MSO Agent session. The worker gets an isolated context window and only the explicit objective/context supplied here; intermediate tool calls stay out of the parent conversation and only the final result returns. It does not create a Local Agent peer, does not run after this call returns, cannot recursively spawn subagents, and cannot use session/memory/local-agent/A2A tools. Use subagents for independent research/review/workstreams where isolation helps; do simple sequential work directly.",
  scope: "exec",
  limit: { key: "agent.subagent", max: 12, windowMs: 60_000 },
  audit: { action: "agent.subagent", targetArg: "name" },
  inputSchema: S({
    objective: { type: "string", description: "Exact focused task for the worker, maximum 24 KiB." },
    name: { type: "string", description: "Optional short display name, e.g. reviewer or researcher." },
    max_scope: { type: "string", enum: ["read", "write", "exec"], description: "Maximum host-tool authority delegated to the child. Default read. The parent call itself is exec-gated as the delegation approval boundary." },
    max_turns: { type: "number", description: "1 to the server-configured OS_SUBAGENT_MAX_TURNS limit (default 12, absolute max 48); default 6." },
    timeout_ms: { type: "number", description: "1000-120000 ms; default 60000." },
    context: { type: "string", description: "Optional explicit parent context. Hidden parent transcript is never copied automatically." },
  }, ["objective"]),
  run: async (a, context) => {
    if (!context.principal || !context.sessionId) throw new Error("subagent requires a conversation-bound MSO session");
    const requested = parseScope(typeof a.max_scope === "string" ? a.max_scope : "read");
    if (!allows(context.scope, requested)) throw new Error(`subagent max_scope ${requested} exceeds caller scope ${context.scope}`);
    if (!context.capabilities) throw new Error("capability runtime unavailable for subagent delegation");
    return runSessionSubagent({
      principal: context.principal,
      parentSessionId: context.sessionId,
      objective: str(a, "objective"),
      name: typeof a.name === "string" ? a.name : undefined,
      maxScope: requested,
      maxTurns: Number(a.max_turns) || undefined,
      timeoutMs: Number(a.timeout_ms) || undefined,
      explicitContext: typeof a.context === "string" ? a.context : undefined,
      capabilities: context.capabilities,
    });
  },
}];
