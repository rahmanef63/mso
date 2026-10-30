import { runSessionSubagent } from "@/lib/agent/subagent-runner";
import {
  startSubagentJob,
  getSubagentJob,
  listSubagentJobs,
  cancelSubagentJob,
} from "@/lib/agent/subagent-jobs";
import { allows, parseScope } from "./scope";
import { type McpTool, S, opt, str } from "./tool-kit";

function validateSubagentDelegation(a: Record<string, unknown>, context: Parameters<McpTool["run"]>[1]) {
  if (!context.principal || !context.sessionId) throw new Error("subagent requires a conversation-bound MSO session");
  const requested = parseScope(typeof a.max_scope === "string" ? a.max_scope : "read");
  if (!allows(context.scope, requested)) throw new Error(`subagent max_scope ${requested} exceeds caller scope ${context.scope}`);
  if (!context.capabilities) throw new Error("capability runtime unavailable for subagent delegation");
  return {
    principal: context.principal,
    parentSessionId: context.sessionId,
    objective: str(a, "objective"),
    name: typeof a.name === "string" ? a.name : undefined,
    maxScope: requested,
    maxTurns: Number(a.max_turns) || undefined,
    timeoutMs: Number(a.timeout_ms) || undefined,
    explicitContext: typeof a.context === "string" ? a.context : undefined,
    capabilities: context.capabilities,
    authority: context,
  };
}

const SUBAGENT_INPUT_PROPERTIES = {
  objective: { type: "string", description: "Exact focused task for the worker, maximum 24 KiB." },
  name: { type: "string", description: "Optional short display name, e.g. reviewer or researcher." },
  max_scope: { type: "string", enum: ["read", "write", "exec"], description: "Maximum host-tool authority delegated to the child. Default read. The parent call itself is exec-gated as the delegation approval boundary." },
  max_turns: { type: "number", description: "1 to the server-configured OS_SUBAGENT_MAX_TURNS limit (default 12, absolute max 48); default 6." },
  timeout_ms: { type: "number", description: "1000-120000 ms; default 60000." },
  context: { type: "string", description: "Optional explicit parent context. Hidden parent transcript is never copied automatically." },
};

export const SUBAGENT_TOOLS: McpTool[] = [
  {
    name: "agent_subagent_run",
    description: "Spawn one foreground focused subagent inside the current durable MSO Agent session. The worker gets an isolated context window and only the explicit objective/context supplied here; intermediate tool calls stay out of the parent conversation and only the final result returns. It does not create a Local Agent peer, does not run after this call returns, cannot recursively spawn subagents, and cannot use session/memory/local-agent/A2A tools. Use subagents for independent research/review/workstreams where isolation helps; do simple sequential work directly.",
    chatgptDescription: "Spawn isolated worker.",
    scope: "exec",
    limit: { key: "agent.subagent", max: 12, windowMs: 60_000 },
    audit: { action: "agent.subagent", targetArg: "name" },
    inputSchema: S(SUBAGENT_INPUT_PROPERTIES, ["objective"]),
    run: async (a, context) => {
      const input = validateSubagentDelegation(a, context);
      return runSessionSubagent(input);
    },
  },
  {
    name: "agent_subagent_start",
    description: "Start one background focused subagent inside the current durable MSO Agent session and return immediately with a job ID. The worker gets an isolated context window with the same scope, turn, and tool restrictions as foreground subagents. It cannot recursively spawn subagents and cannot use session/memory/local-agent/A2A tools. Bounded to 4 concurrent jobs per principal and retained in-memory for 30 minutes after completion; process restart discards jobs. Read status with agent_subagent_status.",
    chatgptDescription: "Start background worker.",
    scope: "exec",
    limit: { key: "agent.subagent", max: 12, windowMs: 60_000 },
    audit: { action: "agent.subagent", targetArg: "name" },
    inputSchema: S(SUBAGENT_INPUT_PROPERTIES, ["objective"]),
    run: async (a, context) => {
      const input = validateSubagentDelegation(a, context);
      return startSubagentJob(input);
    },
  },
  {
    name: "agent_subagent_status",
    description: "Read status of one background subagent job owned by this client, or list all recent jobs when job_id is omitted. Completed results are retained in-memory for 30 minutes after completion, after which status transitions to expired and result is discarded. Jobs disappear if the process restarts.",
    chatgptDescription: "Check background worker.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "exec.job.status", max: 120, windowMs: 60_000 },
    inputSchema: S({ job_id: { type: "string", description: "Optional job id returned by agent_subagent_start. If omitted, returns all recent background subagent jobs for this caller." } }),
    run: (a, context) => {
      if (!context.principal) throw new Error("subagent requires an authenticated MSO client");
      const id = opt(a, "job_id");
      return Promise.resolve(id ? getSubagentJob(id, context.principal) : listSubagentJobs(context.principal));
    },
  },
  {
    name: "agent_subagent_cancel",
    description: "Cancel one still-running background subagent job owned by this client. Aborts the worker via AbortSignal. Repeated cancellation is idempotent.",
    chatgptDescription: "Cancel background worker.",
    scope: "exec",
    annotations: { destructiveHint: true, idempotentHint: true },
    limit: { key: "exec.job.cancel", max: 30, windowMs: 60_000 },
    audit: { action: "agent.subagent", targetArg: "job_id" },
    inputSchema: S({ job_id: { type: "string", description: "Exact job id returned by agent_subagent_start." } }, ["job_id"]),
    run: (a, context) => {
      if (!context.principal) throw new Error("subagent requires an authenticated MSO client");
      return Promise.resolve(cancelSubagentJob(str(a, "job_id"), context.principal));
    },
  },
];
