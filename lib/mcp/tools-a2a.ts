import { createHash } from "node:crypto";
import { cancelA2ATask, discoverA2AAgent, getA2ATask, handoffA2A, listA2AAgents, registerA2AAgent, removeA2AAgent, resolveA2AAgent, sendA2AMessage } from "@/lib/a2a";
import type { A2ADiscoveredAgent, A2ARegisteredAgent } from "@/lib/a2a";
import { type McpTool, S, str } from "./tool-kit";

function optionalString(a: Record<string, unknown>, key: string): string | undefined {
  const value = a[key]; return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function anonymousHash(value?: string): string | undefined {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 24) : undefined;
}
function cardSummary(row: A2ADiscoveredAgent | A2ARegisteredAgent) {
  const card = row.card; const selectedInterface = "selectedInterface" in row ? row.selectedInterface : undefined;
  return {
    ...(row.cardUrl ? { cardUrl: row.cardUrl } : {}), ...( "id" in row ? { id: row.id, alias: row.alias } : {}),
    name: card.name, description: card.description, version: card.version,
    interface: selectedInterface ?? card.supportedInterfaces[0], requiresAuthentication: card.requiresAuthentication,
    capabilities: card.capabilities, inputModes: card.defaultInputModes, outputModes: card.defaultOutputModes,
    skills: card.skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, tags: skill.tags })),
  };
}
async function target(ref: string) { return resolveA2AAgent(ref); }

export const A2A_TOOLS: McpTool[] = [
  {
    name: "a2a_agents_list",
    description: "List A2A v1 agents registered on this MSO host. The registry stores only public Agent Card metadata, never agent credentials or private conversation context.",
    scope: "read", annotations: { readOnlyHint: true, idempotentHint: true }, limit: { key: "a2a.read", max: 30, windowMs: 60_000 }, inputSchema: S({}),
    run: async () => (await listA2AAgents()).map(cardSummary),
  },
  {
    name: "a2a_agent_discover",
    description: "Discover and validate a public A2A v1 Agent Card using the standard /.well-known/agent-card.json path. Only public HTTPS endpoints are allowed; private/loopback targets and DNS rebinding are blocked.",
    scope: "read", annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }, limit: { key: "a2a.discovery", max: 20, windowMs: 60_000 },
    inputSchema: S({ url: { type: "string", description: "Public agent origin or direct Agent Card URL." } }, ["url"]),
    run: async (a) => cardSummary(await discoverA2AAgent(str(a, "url"))),
  },
  {
    name: "a2a_agent_register",
    description: "Register or refresh one public A2A v1 agent in MSO's private host registry. This stores the Agent Card and alias only; credentials are deliberately unsupported in this phase.",
    scope: "write", annotations: { openWorldHint: true }, limit: { key: "a2a.registry", max: 20, windowMs: 60_000 }, audit: { action: "a2a.registry", targetArg: "url" },
    inputSchema: S({ url: { type: "string", description: "Public agent origin or direct Agent Card URL." }, alias: { type: "string", description: "Optional local alias (lowercase letters/digits/._-)." } }, ["url"]),
    run: async (a) => cardSummary(await registerA2AAgent(str(a, "url"), optionalString(a, "alias"))),
  },
  {
    name: "a2a_agent_remove",
    description: "Remove one registered A2A agent alias/id from MSO. This does not contact or modify the remote agent.",
    scope: "write", annotations: { idempotentHint: true }, limit: { key: "a2a.registry", max: 20, windowMs: 60_000 }, audit: { action: "a2a.registry", targetArg: "target" },
    inputSchema: S({ target: { type: "string", description: "Registered A2A alias or id." } }, ["target"]),
    run: async (a) => ({ ok: await removeA2AAgent(str(a, "target")), target: a.target }),
  },
  {
    name: "a2a_message_send",
    description: "Send one text message to a public A2A v1 agent via its advertised JSONRPC or HTTP+JSON interface. Does not expose this MSO session history; only the explicit message and optional A2A context/task ids are transmitted.",
    scope: "exec", annotations: { openWorldHint: true }, limit: { key: "a2a.send", max: 30, windowMs: 60_000 }, audit: { action: "a2a.send", targetArg: "target" },
    result: { maxTextBytes: 64 * 1024, overflowHint: "A2A response was compacted; use a2a_task_get with the returned task id for focused status." },
    inputSchema: S({
      target: { type: "string", description: "Registered alias/id or public Agent Card URL." }, message: { type: "string", description: "Explicit message to the remote agent, max 24 KiB." },
      context_id: { type: "string", description: "Optional A2A contextId supplied by that remote agent." }, task_id: { type: "string", description: "Optional A2A taskId to continue." },
      return_immediately: { type: "boolean", description: "Default true: return the task quickly instead of blocking for completion." },
    }, ["target", "message"]),
    run: async (a) => {
      const agent = await target(str(a, "target")); const result = await sendA2AMessage(agent, str(a, "message"), {
        contextId: optionalString(a, "context_id"), taskId: optionalString(a, "task_id"), returnImmediately: a.return_immediately !== false,
      }); return { agent: cardSummary(agent), response: result };
    },
  },
  {
    name: "a2a_task_get",
    description: "Read the latest state of a task previously returned by an A2A v1 agent. This is the A2A status/poll operation.",
    scope: "read", annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }, limit: { key: "a2a.task", max: 60, windowMs: 60_000 },
    result: { maxTextBytes: 64 * 1024, overflowHint: "A2A task response was compacted; request less history." },
    inputSchema: S({ target: { type: "string" }, task_id: { type: "string" }, history_length: { type: "number", description: "0-100, default 10." } }, ["target", "task_id"]),
    run: async (a) => getA2ATask(await target(str(a, "target")), str(a, "task_id"), Math.max(0, Math.min(100, Number(a.history_length) || 10))),
  },
  {
    name: "a2a_task_cancel",
    description: "Request cancellation of one in-progress A2A v1 task. The remote agent remains authoritative about whether cancellation is allowed.",
    scope: "exec", annotations: { destructiveHint: true, openWorldHint: true }, limit: { key: "a2a.cancel", max: 30, windowMs: 60_000 }, audit: { action: "a2a.cancel", targetArg: "task_id" },
    inputSchema: S({ target: { type: "string" }, task_id: { type: "string" } }, ["target", "task_id"]),
    run: async (a) => cancelA2ATask(await target(str(a, "target")), str(a, "task_id")),
  },
  {
    name: "a2a_handoff",
    description: "Delegate an explicit objective plus optional caller-supplied context to another A2A v1 agent. Hidden MSO history, memory and tool state are NEVER copied; the handoff includes only these arguments and anonymous source hashes.",
    scope: "exec", annotations: { openWorldHint: true }, limit: { key: "a2a.send", max: 30, windowMs: 60_000 }, audit: { action: "a2a.send", targetArg: "target" },
    result: { maxTextBytes: 64 * 1024, overflowHint: "A2A handoff response was compacted; poll the returned task with a2a_task_get." },
    inputSchema: S({
      target: { type: "string", description: "Registered alias/id or public Agent Card URL." }, objective: { type: "string", description: "Delegated objective, max 8 KiB." },
      context: { type: "string", description: "Optional explicit handoff context, max 8 KiB. No hidden session state is added." },
      return_immediately: { type: "boolean", description: "Default true." },
    }, ["target", "objective"]),
    run: async (a, context) => {
      const agent = await target(str(a, "target"));
      const result = await handoffA2A(agent, str(a, "objective"), optionalString(a, "context"), {
        returnImmediately: a.return_immediately !== false, sourceSessionHash: anonymousHash(context.sessionId), sourceWorkflowHash: anonymousHash(context.workflowId),
      });
      return { agent: cardSummary(agent), ...result };
    },
  },
];
