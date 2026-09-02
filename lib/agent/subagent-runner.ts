import { randomUUID } from "node:crypto";
import { getAgentSession } from "./session-store";
import { prepareSelectedModel, streamPreparedSelectedModel } from "@/lib/ai/selected-model-stream";
import type { OaMsg, OaTool, OaToolUse } from "@/lib/ai/openai-stream";
import { allows, parseScope, type Scope } from "@/lib/mcp/scope";

const MAX_RESULT_BYTES = 64 * 1024;
const DEFAULT_TURNS = 6;
const MAX_TURNS = 12;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const DENY_PREFIXES = ["agent_session_", "agent_memory_", "local_agent_", "a2a_"];
const DENY_EXACT = new Set(["agent_subagent_run"]);

function bounded(value: string, max = MAX_RESULT_BYTES): string {
  if (Buffer.byteLength(value, "utf8") <= max) return value;
  let out = value;
  while (Buffer.byteLength(out, "utf8") > max - 80) out = out.slice(0, Math.floor(out.length * 0.9));
  return `${out}\n…[truncated by MSO subagent result budget]`;
}

function allowedTool(name: string): boolean {
  return !DENY_EXACT.has(name) && !DENY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function resultText(rpc: Record<string, unknown>): { content: string; isError: boolean } {
  if (rpc.error) return { content: bounded(`error: ${JSON.stringify(rpc.error)}`), isError: true };
  const result = (rpc.result ?? {}) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const text = (result.content ?? []).filter((row) => row.type === "text").map((row) => row.text ?? "").join("\n");
  return { content: bounded(text || JSON.stringify(result.content ?? [])), isError: Boolean(result.isError) };
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
}) {
  const parent = await getAgentSession(input.principal, input.parentSessionId);
  if (!parent) throw new Error("parent MSO Agent session not found");
  const objective = String(input.objective || "").trim();
  if (!objective) throw new Error("subagent objective is required");
  if (Buffer.byteLength(objective, "utf8") > 24 * 1024) throw new Error("subagent objective must be 24 KiB or smaller");
  const name = String(input.name || "worker").trim().replace(/[\r\n\t]+/g, " ").slice(0, 60) || "worker";
  const maxScope = parseScope(input.maxScope || "read");
  const maxTurns = Math.max(1, Math.min(MAX_TURNS, Math.trunc(input.maxTurns || DEFAULT_TURNS)));
  const timeoutMs = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.trunc(input.timeoutMs || DEFAULT_TIMEOUT_MS)));
  const subagentId = `subagent_${randomUUID()}`;
  const [{ TOOLS }, { dispatch }] = await Promise.all([import("@/lib/mcp/tools"), import("@/lib/mcp/dispatch")]);
  const toolDefs = TOOLS.filter((tool) => allows(maxScope, tool.scope) && allowedTool(tool.name));
  const tools: OaTool[] = toolDefs.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
  const prepared = await prepareSelectedModel();
  const messages: OaMsg[] = [{ role: "user", text: objective }];
  const toolCalls: Array<{ name: string; ok: boolean }> = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("subagent timeout")), timeoutMs);
  let finalText = "";
  try {
    for (let round = 1; round <= maxTurns; round += 1) {
      let text = "";
      const uses: OaToolUse[] = [];
      await streamPreparedSelectedModel({
        prepared, messages, tools,
        system: systemPrompt({ name, objective, cwd: parent.cwd, maxScope, explicitContext: input.explicitContext }),
        signal: controller.signal,
        emit(event, data) {
          if (event === "delta") text += String(data ?? "");
          else if (event === "tool_use") uses.push(data as OaToolUse);
        },
      });
      if (text) finalText = bounded(text);
      messages.push({ role: "assistant", text, toolUses: uses });
      if (!uses.length) return { subagentId, name, status: "completed" as const, text: finalText.trim(), rounds: round, toolCalls, maxScope };
      const results: { id: string; content: string; isError?: boolean }[] = [];
      for (const call of uses) {
        const tool = toolDefs.find((entry) => entry.name === call.name);
        if (!tool) {
          results.push({ id: call.id, content: "error: tool unavailable to this subagent", isError: true });
          toolCalls.push({ name: call.name, ok: false });
          continue;
        }
        const rpc = await dispatch(
          { id: call.id, method: "tools/call", params: { name: call.name, arguments: call.input ?? {} } },
          maxScope,
          `${input.principal}#${subagentId}`,
          { principal: input.principal },
        );
        const outcome = resultText(rpc);
        results.push({ id: call.id, content: outcome.content, ...(outcome.isError ? { isError: true } : {}) });
        toolCalls.push({ name: call.name, ok: !outcome.isError });
      }
      messages.push({ role: "tool", results });
    }
    return { subagentId, name, status: "partial" as const, text: finalText.trim() || "Subagent reached its turn limit before a final answer.", rounds: maxTurns, toolCalls, maxScope };
  } catch (error) {
    if (controller.signal.aborted) return { subagentId, name, status: "timeout" as const, text: finalText.trim(), rounds: 0, toolCalls, maxScope };
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
