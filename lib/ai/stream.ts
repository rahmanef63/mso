// Streams a reply from /api/assistant (SSE) and yields text deltas. Auth = the
// signed session cookie (same-origin, sent automatically). Throws with a stable
// code on auth / no-key / transport errors so the UI can explain. Neutral
// location (root lib) so both the assistant slice AND the os-shell Inspector can
// use it without a slice→slice dependency cycle.

// ── Tool-aware chat (function calling) ──────────────────────────────────────
export type AiTool = { name: string; description: string; input_schema: Record<string, unknown> };
export type AiToolUse = { id: string; name: string; input: Record<string, unknown> };
export type AgentMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolUses?: AiToolUse[] }
  | { role: "tool"; results: { id: string; content: string; isError?: boolean }[] };
export type ProviderUsage = {
  accountingMode?: string;
  apiCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  detailCoverage?: Record<string, number>;
};

export type AgentTurn = {
  text: string;
  reasoning?: string;
  toolUses: AiToolUse[];
  stopReason: string | null;
  usage?: ProviderUsage;
};

// One assistant turn with tools. Streams text via `onDelta` and optional reasoning
// via `onReasoning`, then resolves with accumulated text + any tool_use blocks.
export async function streamAgentTurn(
  messages: AgentMsg[],
  tools: AiTool[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  system?: string,
  onReasoning?: (chunk: string) => void,
): Promise<AgentTurn> {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, tools, ...(system ? { system } : {}) }),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `http_${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let reasoning = "";
  const toolUses: AiToolUse[] = [];
  let stopReason: string | null = null;
  let usage: ProviderUsage | undefined = undefined;
  try {
    while (true) {
      if (signal?.aborted) { await reader.cancel().catch(() => {}); break; }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        if (event === "delta") { const t = JSON.parse(data) as string; text += t; onDelta(t); }
        else if (event === "reasoning") { const r = JSON.parse(data) as string; reasoning += r; onReasoning?.(r); }
        else if (event === "tool_use") toolUses.push(JSON.parse(data) as AiToolUse);
        else if (event === "error") throw new Error(JSON.parse(data) as string);
        else if (event === "done") {
          const payload = JSON.parse(data) as { stopReason?: string; usage?: ProviderUsage };
          stopReason = payload.stopReason ?? null;
          if (payload.usage && typeof payload.usage === "object") {
            usage = payload.usage;
          }
        }
      }
    }
  } catch (err) {
    if (!signal?.aborted) throw err;
    await reader.cancel().catch(() => {});
  }
  return {
    text,
    ...(reasoning ? { reasoning } : {}),
    toolUses,
    stopReason: signal?.aborted ? "aborted" : stopReason,
    ...(usage !== undefined ? { usage } : {}),
  };
}
