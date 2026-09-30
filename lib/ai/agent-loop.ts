import { streamAgentTurn, type AgentMsg, type AiTool } from "./stream";

// Generic tool-execution contract. `invoke` runs one tool call and returns a
// short, model-readable outcome; where the side-effect happens (a client store,
// the VPS host, behind an approval gate) is the caller's concern.
export type ToolInvocation = { name: string; input: Record<string, unknown> };
export type ToolOutcome = { ok: boolean; result: string };

export type AgentEvents = {
  /** Streaming text deltas for the current assistant turn. */
  onDelta: (chunk: string) => void;
  /** A tool the model called, with the local execution outcome. */
  onTool: (name: string, input: Record<string, unknown>, outcome: ToolOutcome) => void;
};

// Drives a function-calling conversation: stream a turn → run any tool_use via
// `invoke` → feed the results back → repeat until the model stops calling tools
// (or the turn cap is hit). Generic over the tool set + executor, so the image
// editor (mutates a client store) and the host agent (drives the VPS, with its
// own approval gate inside `invoke`) share one loop. `system` overrides the
// route's default prompt; `signal` cancels the in-flight stream AND halts the
// loop between turns. Returns the extended history so the caller can continue.
export async function runToolAgent(
  history: AgentMsg[],
  tools: AiTool[],
  invoke: (call: ToolInvocation) => Promise<ToolOutcome>,
  ev: AgentEvents,
  maxTurns = 8,
  system?: string,
  signal?: AbortSignal,
): Promise<{ history: AgentMsg[]; text: string; outcome: "completed" | "stopped" | "limit" }> {
  const msgs = [...history];
  let lastText = "";
  let outcome: "completed" | "stopped" | "limit" = "limit";
  for (let i = 0; i < maxTurns; i++) {
    if (signal?.aborted) { outcome = "stopped"; break; }
    const { text, toolUses } = await streamAgentTurn(msgs, tools, ev.onDelta, signal, system);
    msgs.push({ role: "assistant", text, toolUses });
    if (text) lastText = text;
    if (toolUses.length === 0) { outcome = signal?.aborted ? "stopped" : "completed"; break; }
    const results = [];
    for (const tu of toolUses) {
      if (signal?.aborted) {
        results.push({ id: tu.id, content: "Stopped before execution.", isError: true });
        outcome = "stopped";
        continue;
      }
      const toolOutcome = await invoke({ name: tu.name, input: tu.input });
      ev.onTool(tu.name, tu.input, toolOutcome);
      results.push({ id: tu.id, content: toolOutcome.result, isError: !toolOutcome.ok });
    }
    msgs.push({ role: "tool", results });
  }
  return { history: msgs, text: lastText, outcome: signal?.aborted ? "stopped" : outcome };
}

export type { AgentMsg, AiTool } from "./stream";
