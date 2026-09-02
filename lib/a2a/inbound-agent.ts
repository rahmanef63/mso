import { allows, type Scope } from "@/lib/capabilities/scope";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import {
  prepareSelectedModel,
  streamPreparedSelectedModel,
} from "@/lib/ai/selected-model-stream";
import type { OaMsg, OaTool, OaToolUse } from "@/lib/ai/openai-stream";
import type { AgentSession } from "@/lib/agent/session-types";

const MAX_ROUNDS = 10;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;

const EXTERNAL_TOOL_DENY = new Set([
  "agent_session_current",
  "agent_sessions_list",
  "agent_session_resume",
  "agent_session_rename",
  "agent_session_note",
  "agent_memory_read",
  "agent_memory_search",
  "agent_memory_remember",
  "agent_memory_forget",
]);

function inboundSystem(scope: Scope, session?: AgentSession): string {
  if (session) {
    const snapshot = session.memorySnapshot || { user: "", memory: "" };
    return [
      `You are a same-host MSO sub-agent delegated into durable terminal session ${session.id}.`,
      `Session title: ${session.title}.`,
      session.cwd ? `Session working directory: ${session.cwd}.` : "",
      `This local delegation has maximum tool scope: ${scope}.`,
      "Use the supplied durable session snapshot/history as context, but do not claim to be the live terminal process and do not inject keystrokes into another TTY.",
      "Return the result to the delegating agent. Keep tool/session boundaries explicit.",
      snapshot.user
        ? `<USER.md>\n${String(snapshot.user).slice(0, 12000)}\n</USER.md>`
        : "",
      snapshot.memory
        ? `<MEMORY.md>\n${String(snapshot.memory).slice(0, 12000)}\n</MEMORY.md>`
        : "",
      session.contextSummary
        ? `<COMPACTED_SESSION_CONTEXT>\n${String(session.contextSummary).slice(0, 24000)}\n</COMPACTED_SESSION_CONTEXT>`
        : "",
      "Never expose credentials, private key material, authorization headers, or hidden reasoning.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "You are MSO Agent serving one authenticated external A2A caller.",
    `This bearer grants maximum tool scope: ${scope}. Tools above that scope are not visible and cannot be used.`,
    "Treat the A2A message as the entire caller context. You have NO owner memory, NO prior MSO transcript, NO hidden session, and NO implicit user profile.",
    "Never claim access to context that was not supplied in this A2A task or returned by a visible tool.",
    "Use tools to perform real work when needed. Prefer bounded tools over exec_run.",
    "For multi-step mutations use workflow_start once, keep its workflow_id on later calls, verify, then workflow_finish or workflow_cancel.",
    "Do not store durable personal memory or session notes for the external caller; those tool families are intentionally unavailable.",
    "Never expose credentials, private key material, authorization headers, or hidden reasoning.",
    "Be concise and return a useful final result for the delegating agent.",
  ].join(" ");
}

function sessionHistory(session?: AgentSession): OaMsg[] {
  if (!session || !Array.isArray(session.history)) return [];
  const out: OaMsg[] = [];
  for (const raw of session.history.slice(-24)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.role === "user" && typeof row.text === "string")
      out.push({ role: "user", text: row.text.slice(0, 24000) });
    else if (row.role === "assistant")
      out.push({
        role: "assistant",
        text: typeof row.text === "string" ? row.text.slice(0, 24000) : "",
        ...(Array.isArray(row.toolUses)
          ? { toolUses: row.toolUses as OaToolUse[] }
          : {}),
      });
    else if (row.role === "tool" && Array.isArray(row.results))
      out.push({
        role: "tool",
        results: row.results as {
          id: string;
          content: string;
          isError?: boolean;
        }[],
      });
  }
  return out;
}

function modelTools(runtime: CapabilityRuntime, scope: Scope): OaTool[] {
  return runtime.list(scope).filter(
    (tool) => allows(scope, tool.scope) && !EXTERNAL_TOOL_DENY.has(tool.name),
  ).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function bounded(value: string, max = MAX_RESULT_BYTES): string {
  if (Buffer.byteLength(value, "utf8") <= max) return value;
  let out = value;
  while (Buffer.byteLength(out, "utf8") > max - 80)
    out = out.slice(0, Math.floor(out.length * 0.9));
  return `${out}\n…[truncated by MSO A2A result budget]`;
}

function toolResultText(result: Awaited<ReturnType<CapabilityRuntime["invoke"]>>): {
  content: string;
  isError: boolean;
} {
  const text = result.content
    .filter((row): row is Extract<(typeof result.content)[number], { type: "text" }> => row.type === "text")
    .map((row) => row.text)
    .join("\n");
  return {
    content: bounded(text || JSON.stringify(result.content)),
    isError: Boolean(result.isError),
  };
}

export async function runInboundA2AAgent(input: {
  prompt: string;
  scope: Scope;
  principal: string;
  taskId: string;
  session?: AgentSession;
  signal: AbortSignal;
  onDelta?: (text: string) => void | Promise<void>;
  capabilities: CapabilityRuntime;
}): Promise<{
  text: string;
  rounds: number;
  toolCalls: Array<{ name: string; ok: boolean }>;
}> {
  const prepared = await prepareSelectedModel();
  const tools = modelTools(input.capabilities, input.scope);
  const messages: OaMsg[] = [
    ...sessionHistory(input.session),
    { role: "user", text: input.prompt },
  ];
  const toolCalls: Array<{ name: string; ok: boolean }> = [];
  let output = "";

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    if (input.signal.aborted)
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error("A2A task canceled");
    let text = "";
    const uses: OaToolUse[] = [];
    await streamPreparedSelectedModel({
      prepared,
      messages,
      tools,
      system: inboundSystem(input.scope, input.session),
      signal: input.signal,
      emit(event, data) {
        if (event === "delta") {
          const chunk = String(data ?? "");
          text += chunk;
          if (Buffer.byteLength(output + text, "utf8") <= MAX_OUTPUT_BYTES)
            void input.onDelta?.(chunk);
        } else if (event === "tool_use") uses.push(data as OaToolUse);
      },
    });
    output = bounded(output + text, MAX_OUTPUT_BYTES);
    messages.push({ role: "assistant", text, toolUses: uses });
    if (!uses.length) return { text: output.trim(), rounds: round, toolCalls };

    const results: { id: string; content: string; isError?: boolean }[] = [];
    for (const call of uses) {
      const tool = input.capabilities.list(input.scope).find((entry) => entry.name === call.name);
      if (!tool || EXTERNAL_TOOL_DENY.has(call.name) || !allows(input.scope, tool.scope)) {
        results.push({
          id: call.id,
          content: "error: tool is unavailable to this A2A credential",
          isError: true,
        });
        toolCalls.push({ name: call.name, ok: false });
        continue;
      }
      const invoked = await input.capabilities.invoke({
        name: call.name,
        args: call.input ?? {},
        scope: input.scope,
        actor: input.principal,
        principal: input.principal,
        sessionId: input.taskId,
      });
      const result = toolResultText(invoked);
      results.push({
        id: call.id,
        content: result.content,
        ...(result.isError ? { isError: true } : {}),
      });
      toolCalls.push({ name: call.name, ok: !result.isError });
    }
    messages.push({ role: "tool", results });
  }
  return {
    text: bounded(
      output ||
        "Task reached the MSO A2A tool-round limit before producing a final answer.",
      MAX_OUTPUT_BYTES,
    ),
    rounds: MAX_ROUNDS,
    toolCalls,
  };
}
