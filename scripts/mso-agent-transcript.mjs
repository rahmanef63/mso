import { formatEditDiff } from "./mso-agent-edit-diff.mjs";
import { formatTodoBlock } from "./mso-agent-todos.mjs";
import { formatDiffBody } from "./mso-agent-diff.mjs";

const DEFAULT_CLIP_CHARS = 1000;

function safeJson(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function getHistory(session) {
  if (Array.isArray(session)) return session;
  if (Array.isArray(session?.history)) return session.history;
  if (Array.isArray(session?.agentSession?.history)) return session.agentSession.history;
  return [];
}

function rolePrefix(role, colors) {
  if (!colors || Object.keys(colors).length === 0) return `[${role}] `;
  const reset = colors.reset || "";
  const tone = role === "user" ? (colors.blue || colors.c || "")
    : role === "assistant" ? (colors.cyan || colors.c || "")
      : role === "tool" ? (colors.warn || colors.dim || "")
        : role === "agent" ? (colors.c || colors.cyan || "")
          : (colors.dim || "");
  return tone ? `${tone}[${role}]${reset} ` : `[${role}] `;
}

function pushMultiline(lines, prefix, text) {
  const parts = String(text ?? "").replace(/\r/g, "").split("\n");
  if (parts.length) lines.push(`${prefix}${parts[0]}`);
  for (let j = 1; j < parts.length; j += 1) lines.push(`  ${parts[j]}`);
}

function formatCallArgs(input) {
  if (!input || typeof input !== "object" || Object.keys(input).length === 0) return "";
  try {
    const raw = JSON.stringify(input);
    return raw.length > 60 ? ` ${raw.slice(0, 57)}...` : ` ${raw}`;
  } catch { return ""; }
}

function formatCompactedPlaceholder(payload) {
  const handles = Array.isArray(payload?.handles) && payload.handles.length
    ? `: ${payload.handles.map((h) => h?.path || h?.jobId || h?.artifactId || h?.kind).filter(Boolean).join(", ")}`
    : "";
  const note = payload?.instruction ? ` (${payload.instruction})` : "";
  return `[compacted replay${handles}]${note}`;
}

function formatToolPayload(toolName, result, colors, clipLimit, width) {
  if (!result || typeof result !== "object") return ["(no result)"];
  if (result.msoReplay === true) return [formatCompactedPlaceholder(safeJson(result.content) || result)];
  const raw = typeof result.content === "string" ? result.content : result.content != null ? JSON.stringify(result.content) : "";
  if (!raw) return ["(no result)"];
  const parsed = safeJson(raw);
  if (parsed?.msoReplay === true) return [formatCompactedPlaceholder(parsed)];
  if (parsed && typeof parsed.diff === "string") {
    const editLines = formatEditDiff(parsed, { colors });
    if (editLines) return editLines.split("\n");
  }
  if (parsed && Array.isArray(parsed.items)) {
    const todoLines = formatTodoBlock(parsed, { colors, columns: width });
    if (todoLines) return todoLines.split("\n");
  }
  if (raw.startsWith("diff --git") || raw.startsWith("@@ ")) {
    const diffLines = formatDiffBody(raw, { colors });
    if (diffLines) return diffLines.split("\n").map((l) => `  ${l}`);
  }
  const clipped = raw.length > clipLimit ? `${raw.slice(0, clipLimit)} ... [clipped]` : raw;
  return clipped.replace(/\r/g, "").split("\n");
}

export function transcriptLines(session, { colors, width, groupTools = false, maxPerTool = 1, clipLimit = DEFAULT_CLIP_CHARS } = {}) {
  const history = getHistory(session);
  const lines = [];
  let lastToolCalls = new Map();
  let lastToolCallList = [];

  for (let i = 0; i < history.length; i += 1) {
    const row = history[i];
    if (!row || typeof row !== "object") continue;

    if (row.role === "user") {
      pushMultiline(lines, rolePrefix("user", colors), typeof row.text === "string" ? row.text : (row.text != null ? String(row.text) : ""));
    } else if (row.role === "assistant") {
      lastToolCalls = new Map();
      lastToolCallList = Array.isArray(row.toolUses) ? row.toolUses : [];
      for (const call of lastToolCallList) if (call?.id) lastToolCalls.set(String(call.id), String(call.name || "tool"));
      const prefix = rolePrefix("assistant", colors);
      const text = typeof row.text === "string" ? row.text : (row.text != null ? String(row.text) : "");
      if (text.trim()) pushMultiline(lines, prefix, text);
      for (const call of lastToolCallList) {
        if (!call || typeof call !== "object") continue;
        lines.push(`${prefix}call ${String(call.name || "tool")}${formatCallArgs(call.input)}`);
      }
    } else if (row.role === "tool") {
      const prefix = rolePrefix("tool", colors);
      const results = Array.isArray(row.results) ? row.results : (row.result != null || row.content != null ? [row] : []);
      if (!results.length) lines.push(`${prefix}${row.name || "tool"}: (no result)`);
      for (let rIdx = 0; rIdx < results.length; rIdx += 1) {
        const item = results[rIdx];
        const isErr = Boolean(item?.isError || item?.error || row.isError || row.error);
        const id = item?.id ? String(item.id) : "";
        const toolName = item?.name || item?.tool || row.name || (id ? lastToolCalls.get(id) : null) || lastToolCallList[rIdx]?.name || "tool";
        const pl = formatToolPayload(toolName, item, colors, clipLimit, width);
        // Error tag ensures tool calls with an isError flag render visibly even if payload lacks an error prefix
        const errTag = isErr && !/\b(error|failed|failure)\b/i.test(pl[0] || "") ? " (error)" : "";
        if (pl.length === 1) lines.push(`${prefix}${toolName}${errTag}: ${pl[0]}`);
        else {
          lines.push(`${prefix}${toolName}${errTag}:`);
          for (const line of pl) lines.push(line.startsWith("  ") ? line : `  ${line}`);
        }
      }
    } else if (row.role === "agent") {
      const sender = row.senderLabel ? `@${row.senderLabel}: ` : "";
      pushMultiline(lines, rolePrefix("agent", colors), `${sender}${typeof row.text === "string" ? row.text : (row.text != null ? String(row.text) : "")}`);
    } else {
      const text = typeof row.text === "string" ? row.text : (row.content ? String(row.content) : "");
      if (text) pushMultiline(lines, rolePrefix(String(row.role || "unknown"), colors), text);
    }
  }

  return groupTools ? groupToolRows(lines, { maxPerTool }) : lines;
}

// Collapsing consecutive rows of the same tool is the right default because
// autonomous agent turns often invoke dozens of repetitive tool calls in loops
// (e.g. read files or stat paths). Collapsing them preserves scrollback budget.
export function groupToolRows(lines, { maxPerTool = 1 } = {}) {
  if (!Array.isArray(lines) || !lines.length) return [];
  if (typeof lines[0] === "object" && lines[0] !== null && "role" in lines[0]) {
    const out = [];
    let cur = null, grp = [];
    const flush = () => {
      if (!grp.length) return;
      if (grp.length > maxPerTool) out.push({ role: "tool", name: cur, count: grp.length, collapsed: true });
      else out.push(...grp);
      grp = []; cur = null;
    };
    for (const r of lines) {
      // Failed tool calls must never be hidden into a count summary
      const isErr = Boolean(r?.isError || r?.error || r?.results?.some((x) => x?.isError || x?.error));
      const name = r?.role === "tool" && !isErr ? (r.name || r.results?.[0]?.name || "tool") : null;
      if (name) {
        if (cur === name) grp.push(r);
        else { flush(); cur = name; grp = [r]; }
      } else { flush(); out.push(r); }
    }
    flush();
    return out;
  }

  const out = [];
  let curTool = null, curPrefix = "", curLines = [], toolCount = 0;
  const flush = () => {
    if (!curLines.length) return;
    if (toolCount > maxPerTool) out.push(`${curPrefix}${curTool} (${toolCount} calls)`);
    else out.push(...curLines);
    curTool = null; curPrefix = ""; curLines = []; toolCount = 0;
  };

  for (const line of lines) {
    const plain = String(line || "").replace(/\x1b\[[0-9;]*m/g, "");
    const m = plain.match(/^\[([a-zA-Z0-9_-]+)\]\s+([a-zA-Z0-9_.-]+)(?::|\s|\(|$)/);
    // Explicit errors must never be collapsed into a count line
    const isErr = m && m[1] === "tool" && (plain.includes("(error)") || /^\[[a-zA-Z0-9_-]+\]\s+[a-zA-Z0-9_.-]+:\s*(?:error|failed|failure)\b/i.test(plain));
    if (m && m[1] === "tool" && !isErr) {
      const tool = m[2];
      const pfx = (line.match(/^([^\s]+)\s+/) || [])[0] || "[tool] ";
      if (curTool === tool) {
        toolCount += 1;
        curLines.push(line);
      } else {
        flush();
        curTool = tool; curPrefix = pfx; curLines = [line]; toolCount = 1;
      }
    } else if (curLines.length && String(line).startsWith("  ")) {
      curLines.push(line);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out;
}

export function transcriptStats(session) {
  const history = getHistory(session);
  let userTurns = 0, assistantTurns = 0, assistantToolCalls = 0, standaloneToolResults = 0;

  for (let i = 0; i < history.length; i += 1) {
    const row = history[i];
    if (!row || typeof row !== "object") continue;
    if (row.role === "user") userTurns += 1;
    else if (row.role === "assistant") {
      assistantTurns += 1;
      if (Array.isArray(row.toolUses)) assistantToolCalls += row.toolUses.length;
    } else if (row.role === "tool") {
      const prev = i > 0 ? history[i - 1] : null;
      const count = Array.isArray(row.results) ? row.results.length : 1;
      if (!prev || prev.role !== "assistant" || !Array.isArray(prev.toolUses) || !prev.toolUses.length) {
        standaloneToolResults += count;
      }
    }
  }

  return { rows: history.length, userTurns, assistantTurns, toolCalls: assistantToolCalls + standaloneToolResults };
}
