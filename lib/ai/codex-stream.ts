import type { OAuthBundle } from "@/lib/config/store";
import { CODEX } from "./oauth/codex";
import type { OaMsg, OaTool } from "./openai-stream";

// Stream a chat via the ChatGPT "Codex" backend Responses API. Unlike the OpenAI
// platform (/chat/completions), this is the consumer backend: the OAuth bearer +
// the account id from the token, the Responses request shape, and SSE events named
// `response.output_text.delta`. Emits the same delta|tool_use|done vocab the other
// streamers do, so the client stays provider-agnostic.
//
// THIS PATH USED TO DROP `tools` AND WAS COMMENTED "chat-only — no tools". That was
// wrong, and it made the whole assistant look broken: the UI advertised its catalog
// while the model correctly reported having none. The backend supports tools fine —
// our request just never carried them. Verified against Hermes, which drives the
// SAME endpoint with tools (agent/codex_responses_adapter.py).
//
// The Responses tool shape is neither Anthropic's nor Chat Completions': it is FLAT.
//   Anthropic         { name, description, input_schema }
//   Chat Completions  { type:"function", function:{ name, description, parameters } }
//   Responses         { type:"function", name, description, strict, parameters }
// Getting this wrong is a 400 with no useful body, which is most of why the
// chat-only shortcut looked reasonable at the time.

/** Provider-EXECUTED tools: declared by type alone, no schema, the provider runs
 *  them and streams the result back. Kept as an allowlist rather than pass-through:
 *  an unknown type is a 400.
 *
 *  `image_generation` is deliberately ABSENT. MSO no longer generates images on any
 *  surface: a GPT client already carries its own image generation, and declaring a
 *  second one made the model pick between two tools that do the same thing. Adding
 *  it back means re-adding the capability, not flipping a flag. */
const BUILTIN_TOOL_TYPES = new Set([
  "web_search",
  "web_search_preview",
  "file_search",
  "code_interpreter",
  "computer_use_preview",
  "local_shell",
]);

type ResponsesTool =
  | { type: "function"; name: string; description: string; strict: boolean; parameters: Record<string, unknown> }
  | { type: string };

/** Provider-run built-ins available to Codex. NONE are enabled by default — the
 *  owner opts in per deployment with a comma/space-separated `OS_CODEX_BUILTIN_TOOLS`
 *  drawn from the allowlist above. Unknown entries are dropped rather than sent. */
function builtinTools(): ResponsesTool[] {
  return (process.env.OS_CODEX_BUILTIN_TOOLS ?? "")
    .split(/[\s,]+/)
    .filter((t) => BUILTIN_TOOL_TYPES.has(t))
    .map((type) => ({ type }));
}

/** The Responses API enforces `^[a-zA-Z0-9_-]+$` on a tool name — NO DOTS. Our
 *  catalog is dot.case (`fs.list`, `exec.run`), which Anthropic accepts and this
 *  backend rejects with a 400 naming only `tools[0].name`. So the wire name is
 *  underscored and mapped back when the call returns; the model never sees the
 *  difference and nothing downstream has to know.
 *  Only a live request finds this: every unit test that mocks fetch passes with
 *  dots still in place. */
const wireName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");

const toResponsesTool = (t: OaTool): ResponsesTool => ({
  type: "function",
  name: wireName(t.name),
  description: t.description ?? "",
  // strict:false deliberately — strict mode requires every property to be
  // `required` and `additionalProperties:false`, which the host-tool catalog does
  // not satisfy (most tools have optional args). A strict:true schema mismatch is
  // rejected at request time, not at call time.
  strict: false,
  parameters: t.input_schema,
});

/** Our neutral message list → Responses `input` items.
 *  A tool round-trip is TWO item types, not a role: the assistant's call is a
 *  `function_call` item and the result is a `function_call_output` item, both keyed
 *  by the same call_id. Dropping either one makes the next turn 400 with
 *  "No tool output found for function call". */
function toResponsesInput(messages: OaMsg[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      for (const r of m.results) {
        items.push({ type: "function_call_output", call_id: r.id, output: r.content });
      }
      continue;
    }
    const text = ("text" in m && m.text) || "";
    if (text.trim()) {
      items.push({
        type: "message",
        role: m.role,
        content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text }],
      });
    }
    if (m.role === "assistant") {
      for (const u of m.toolUses ?? []) {
        items.push({
          type: "function_call",
          call_id: u.id,
          // Same rename as the declaration, or the replayed call names a tool the
          // request never declared and the turn 400s.
          name: wireName(u.name),
          arguments: JSON.stringify(u.input ?? {}),
        });
      }
    }
  }
  return items;
}

export async function streamCodex(opts: {
  bundle: OAuthBundle;
  model: string;
  messages: OaMsg[];
  tools?: OaTool[];
  system: string;
  signal: AbortSignal;
  emit: (event: "delta" | "tool_use" | "done", data: unknown) => void;
}): Promise<void> {
  const { bundle, model, messages, tools, system, signal, emit } = opts;
  if (signal.aborted) return;

  const declared: ResponsesTool[] = [...(tools ?? []).map(toResponsesTool), ...builtinTools()];
  // wire name → the name the rest of the app uses. Built from the DECLARED set, so
  // a genuine underscore name can never be rewritten into someone else's dot name.
  const realName = new Map((tools ?? []).map((t) => [wireName(t.name), t.name]));

  const res = await fetch(`${CODEX.apiBase}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bundle.access}`,
      originator: "codex_cli_rs",
      "user-agent": "codex_cli_rs/0.0.0 (mso)",
      "chatgpt-account-id": bundle.accountId ?? "",
      "openai-beta": "responses=experimental",
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      // The backend REQUIRES store:false — it rejects anything else outright.
      store: false,
      stream: true,
      instructions: system,
      input: toResponsesInput(messages),
      ...(declared.length ? { tools: declared, parallel_tool_calls: false } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`openai-codex HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let sawToolCall = false;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null = null;
  const seen = new Set<string>();

  while (true) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let ev: {
        type?: string; delta?: string; item?: ResponsesItem;
        response?: { output?: ResponsesItem[]; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } };
      };
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
        emit("delta", ev.delta);
        continue;
      }
      // A completed function_call arrives as an output_item; `response.completed`
      // repeats the full output, so both are scanned and deduped by call_id — the
      // model would otherwise be answered twice for one call.
      if (ev.type === "response.output_item.done" && ev.item) {
        if (emitCall(ev.item, seen, realName, emit)) sawToolCall = true;
      } else if (ev.type === "response.completed") {
        if (ev.response?.usage) {
          usage = {
            inputTokens: ev.response.usage.input_tokens,
            outputTokens: ev.response.usage.output_tokens,
            totalTokens: ev.response.usage.total_tokens,
          };
        }
        for (const item of ev.response?.output ?? []) {
          if (emitCall(item, seen, realName, emit)) sawToolCall = true;
        }
      }
    }
  }
  // The agent loop keys entirely off stopReason: reporting end_turn after a call
  // would strand the tool result and end the run mid-task.
  emit("done", { stopReason: sawToolCall ? "tool_use" : "end_turn", ...(usage ? { usage } : {}) });
}

type ResponsesItem = {
  type?: string;
  status?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: unknown;
};

/** Emit one `function_call` item as a neutral tool_use. Returns whether it did. */
function emitCall(
  item: ResponsesItem,
  seen: Set<string>,
  realName: Map<string, string>,
  emit: (e: "tool_use", d: unknown) => void,
): boolean {
  if (item?.type !== "function_call") return false;
  // Partial items stream before the arguments are complete; acting on one would
  // call the tool with truncated JSON.
  if (item.status && ["queued", "in_progress", "incomplete"].includes(item.status)) return false;
  const id = (item.call_id ?? item.id ?? "").trim();
  const wire = (item.name ?? "").trim();
  const name = realName.get(wire) ?? wire;
  if (!id || !name || seen.has(id)) return false;
  seen.add(id);
  let input: Record<string, unknown> = {};
  try {
    const raw = typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {});
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object") input = parsed as Record<string, unknown>;
  } catch {
    // Malformed arguments: still surface the call so the loop can answer with an
    // error the model can correct, rather than silently dropping the turn.
  }
  emit("tool_use", { id, name, input });
  return true;
}
