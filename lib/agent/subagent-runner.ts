import { randomUUID } from "node:crypto";
import { getAgentSession } from "./session-store";
import { prepareSelectedModel } from "@/lib/ai/selected-model-stream";
import { allows, parseScope, type Scope } from "@/lib/capabilities/scope";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { CapabilityRunContext } from "@/lib/capabilities/tool";
import { runBoundedAgent, type BoundedAgentProgress } from "./bounded-runner";
import { intEnv } from "./session-policy";

const DEFAULT_TURNS = 6;
const ABSOLUTE_MAX_TURNS = 48;
// Owner-tunable ceilings (historical defaults preserved). `OS_SUBAGENT_MAX_TURNS`
// still caps one invocation; the absolute ceiling and the timeout budget can be
// raised for long delegated runs.
function maxTurnsLimit(): number {
  const configured = Number(process.env.OS_SUBAGENT_MAX_TURNS);
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(absoluteMaxTurns(), Math.trunc(configured)))
    : Math.min(12, absoluteMaxTurns());
}
function absoluteMaxTurns(): number {
  return intEnv("OS_SUBAGENT_ABSOLUTE_MAX_TURNS", ABSOLUTE_MAX_TURNS, 1, 10_000);
}
function defaultTurns(): number {
  return Math.min(absoluteMaxTurns(), intEnv("OS_SUBAGENT_DEFAULT_TURNS", DEFAULT_TURNS, 1, 10_000));
}
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
function maxTimeoutMs(): number {
  return intEnv("OS_SUBAGENT_MAX_TIMEOUT_MS", MAX_TIMEOUT_MS, 1_000, 7_200_000);
}
const DENY_PREFIXES = ["agent_session_", "agent_memory_", "local_agent_", "a2a_"];
const DENY_EXACT = new Set(["agent_subagent_run", "project_agent_run"]);
function allowedTool(name: string): boolean {
  return !DENY_EXACT.has(name) && !DENY_PREFIXES.some(prefix => name.startsWith(prefix));
}
function systemPrompt(input: { name: string; objective: string; cwd?: string; maxScope: Scope; explicitContext?: string }): string {
  return [
    `You are MSO subagent ${input.name}, a focused worker spawned inside one parent MSO Agent session.`,
    "You have an isolated context window. You do not inherit the parent's hidden transcript, local-agent mailbox, memory tools, session-management tools, or other subagents.",
    input.cwd ? `Working directory: ${input.cwd}.` : "",
    `Maximum delegated tool scope: ${input.maxScope}.`,
    input.explicitContext ? `<EXPLICIT_PARENT_CONTEXT>\n${input.explicitContext.slice(0, 16_000)}\n</EXPLICIT_PARENT_CONTEXT>` : "",
    `Objective: ${input.objective}`,
    "Work only on this objective. Use available tools when needed. Intermediate tool calls stay inside this subagent; return one concise final result to the parent.",
    "Do not spawn another subagent. Do not message other sessions. Never expose credentials, authorization headers, private keys, tool arguments, or hidden reasoning.",
  ].filter(Boolean).join(" ");
}
export async function runSessionSubagent(input: {
  principal: string;
  parentSessionId: string;
  objective: string;
  name?: string;
  maxScope?: string;
  maxTurns?: number;
  timeoutMs?: number;
  explicitContext?: string;
  capabilities: CapabilityRuntime;
  authority: CapabilityRunContext;
}) {
  const parent = await getAgentSession(input.principal, input.parentSessionId);
  if (!parent) throw new Error("parent MSO Agent session not found");
  const objective = String(input.objective || "").trim();
  if (!objective) throw new Error("subagent objective is required");
  if (Buffer.byteLength(objective, "utf8") > 24 * 1024) throw new Error("subagent objective must be 24 KiB or smaller");
  const name = String(input.name || "worker").trim().replace(/[\r\n\t]+/g, " ").slice(0, 60) || "worker";
  const maxScope = parseScope(input.maxScope || "read");
  if (!allows(input.authority.scope, maxScope)) throw new Error("subagent scope exceeds initiating authority");
  const maxTurns = Math.max(1, Math.min(maxTurnsLimit(), Math.trunc(input.maxTurns || defaultTurns())));
  const timeoutMs = Math.max(1_000, Math.min(maxTimeoutMs(), Math.trunc(input.timeoutMs || DEFAULT_TIMEOUT_MS)));
  const subagentId = `subagent_${randomUUID()}`;
  const authority = { ...input.authority, principal: input.authority.principal ?? input.principal, scope: maxScope, capabilities: input.capabilities };
  const toolDefs = (context: CapabilityRunContext) => input.capabilities.list(context.scope, context).filter(tool => allows(context.scope, tool.scope) && allowedTool(tool.name) && (!context.allowedTools || context.allowedTools.includes(tool.name)));
  const prepared = await prepareSelectedModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("subagent timeout")), timeoutMs);
  const signal = AbortSignal.any([controller.signal, ...(authority.signal ? [authority.signal] : [])]);
  const progress: BoundedAgentProgress = { text: "", toolCalls: [] };
  try {
    const result = await runBoundedAgent({ prepared, objective, system: systemPrompt({ name, objective, cwd: parent.cwd, maxScope, explicitContext: input.explicitContext }),
      capabilities: input.capabilities, authority, actor: `${input.principal}#${subagentId}`, tools: toolDefs, maxTurns, signal, progress });
    const text = result.status === "partial" && !progress.text.trim() ? "Subagent reached its turn limit before a final answer." : result.text;
    return { subagentId, name, status: result.status, text, rounds: result.rounds, toolCalls: result.toolCalls, maxScope };
  } catch (error) {
    if (controller.signal.aborted) return { subagentId, name, status: "timeout" as const, text: progress.text.trim(), rounds: 0, toolCalls: progress.toolCalls, maxScope };
    throw error;
  } finally { clearTimeout(timeout); }
}
