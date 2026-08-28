// OpenAI-protocol streaming adapter for /api/assistant. Every provider in the
// @rahmanef/models registry except Anthropic speaks the OpenAI Chat Completions
// wire (POST {baseUrl}/chat/completions, `data: {choices:[{delta}]}` SSE lines
// ending in `data: [DONE]`). The lib's own chat() is buffered, so this is the
// streaming translator: it maps our neutral message/tool shapes to OpenAI's and
// emits the SAME delta|tool_use|done events the Anthropic path does — so the
// client stays provider-agnostic. Errors throw; the route catch emits `error`.
//
// Server-only (uses fetch against the provider with the host-gated BYOK key).

export type OaToolUse = { id: string; name: string; input: Record<string, unknown> };
export type OaMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolUses?: OaToolUse[] }
  | { role: "tool"; results: { id: string; content: string; isError?: boolean }[] };
export type OaTool = { name: string; description: string; input_schema: Record<string, unknown> };

type OaOutMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

type OaChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
};

// Anthropic input_schema IS a JSON Schema, which is what OpenAI wants in
// function.parameters — so tool translation is a straight remap.
function toOpenAITools(tools: OaTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function toOpenAIMessages(system: string, messages: OaMsg[]): OaOutMsg[] {
  const out: OaOutMsg[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      if (m.text?.trim()) out.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      const msg: OaOutMsg = { role: "assistant", content: m.text || "" };
      if (m.toolUses?.length) {
        msg.tool_calls = m.toolUses.map((u) => ({
          id: u.id,
          type: "function",
          // OpenAI expects arguments as a JSON *string*.
          function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) },
        }));
        if (!m.text) msg.content = null; // content must be null when only tool_calls
      }
      out.push(msg);
    } else {
      // Each tool result becomes its own role:"tool" message keyed by call id.
      for (const r of m.results) out.push({ role: "tool", content: r.content, tool_call_id: r.id });
    }
  }
  return out;
}

// Map OpenAI finish_reason → the stopReason vocab the agent loop already reads
// (it treats "tool_use" as "run the tools, then continue").
function toStopReason(finish: string | null): string {
  if (finish === "tool_calls") return "tool_use";
  if (finish === "length") return "max_tokens";
  return "end_turn";
}

export async function streamOpenAI(opts: {
  resolved: { baseUrl: string; apiKey: string; model: string; provider: string };
  messages: OaMsg[];
  tools?: OaTool[];
  system: string;
  signal: AbortSignal;
  emit: (event: "delta" | "tool_use" | "done", data: unknown) => void;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { resolved, messages, tools, system, signal, emit } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (signal.aborted) return;

  const res = await fetchImpl(`${resolved.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${resolved.apiKey}` },
    body: JSON.stringify({
      model: resolved.model,
      stream: true,
      messages: toOpenAIMessages(system, messages),
      ...(tools && tools.length ? { tools: toOpenAITools(tools) } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${resolved.provider} HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  // tool_call fragments arrive split across chunks; accumulate by index.
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let finish: string | null = null;

  reading: while (true) {
    if (signal.aborted) { await reader.cancel().catch(() => {}); return; }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? ""; // keep the trailing partial line
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue; // skip blank lines / SSE comments
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") break reading;
      let chunk: OaChunk;
      try { chunk = JSON.parse(data) as OaChunk; } catch { continue; }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) emit("delta", choice.delta.content);
      for (const tc of choice.delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(idx, cur);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }

  for (const [, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    let input: Record<string, unknown> = {};
    if (c.args) { try { input = JSON.parse(c.args); } catch { input = {}; } }
    emit("tool_use", { id: c.id || `call_${c.name}`, name: c.name, input });
  }
  emit("done", { stopReason: toStopReason(finish) });
}
