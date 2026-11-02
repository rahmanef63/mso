import fs from "node:fs";
import path from "node:path";

// Strips ANSI escape sequences so exported transcripts are clean readable Markdown.
export function stripAnsi(text) {
  if (!text) return "";
  // ESC followed by CSI, OSC, or bare ESC bytes
  return String(text).replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b/g, "");
}

// Collapses multi-line strings into a single line for compact tool rows.
export function collapseToOneLine(content, maxLen = 120) {
  if (content == null) return "(no output)";
  const str = typeof content === "object" ? JSON.stringify(content) : String(content);
  const flattened = str.replace(/[\r\n\t]+/g, " ").trim();
  if (!flattened) return "(empty)";
  if (flattened.length > maxLen) {
    return `${flattened.slice(0, maxLen - 3)}...`;
  }
  return flattened;
}

// Determines if a tool invocation failed so errors are never hidden.
export function isToolFailure(row, item) {
  if (row?.isError === true || item?.isError === true) return true;
  if (row?.error != null || item?.error != null) return true;
  if (row?.status === "error" || item?.status === "error") return true;
  if (typeof row?.exitCode === "number" && row.exitCode !== 0) return true;
  if (typeof item?.exitCode === "number" && item.exitCode !== 0) return true;
  return false;
}

// Extracts normalized metadata for session header generation.
export function extractSessionMeta(session) {
  const root = session?.session && typeof session.session === "object" ? session.session : session;
  const agentSession = root?.agentSession && typeof root.agentSession === "object" ? root.agentSession : root;
  const cfg = root?.state?.config || {};

  const name = String(agentSession?.name || root?.name || agentSession?.id || root?.id || "session").replace(/^@/, "");
  const title = String(agentSession?.title || root?.title || "MSO Agent session").trim();
  const model = String(agentSession?.model || root?.model || cfg.model || "unknown").trim();

  const history = Array.isArray(root?.history)
    ? root.history
    : Array.isArray(agentSession?.history)
      ? agentSession.history
      : Array.isArray(session)
        ? session
        : [];

  const turnCount = typeof agentSession?.historyTurns === "number"
    ? agentSession.historyTurns
    : typeof root?.historyTurns === "number"
      ? root.historyTurns
      : history.filter((r) => r?.role === "user").length;

  const time = String(
    agentSession?.updatedAt || root?.updatedAt ||
    agentSession?.createdAt || root?.createdAt ||
    root?.time || new Date().toISOString()
  );

  return { name, title, model, turnCount, time, history };
}

// Formats a tool history row: successful rows collapse to one line; failures stay expanded.
export function formatToolRow(row, lastToolCalls) {
  const results = Array.isArray(row?.results) ? row.results : [row];
  const lines = [];

  for (let idx = 0; idx < results.length; idx += 1) {
    const item = results[idx];
    const isErr = isToolFailure(row, item);
    const id = item?.id ? String(item.id) : "";
    const name = item?.name || item?.tool || row?.name || (id && lastToolCalls ? lastToolCalls.get(id) : null) || "tool";
    const rawContent = item?.content != null ? item.content : (item?.result != null ? item.result : (item?.error != null ? item.error : ""));

    if (isErr) {
      // Failed rows stay expanded because hiding error traces misrepresents session results.
      const errText = typeof rawContent === "object" ? JSON.stringify(rawContent, null, 2) : String(rawContent || "error");
      lines.push(`- **Tool** (${name}) [FAILED]:`);
      lines.push("```");
      lines.push(errText);
      lines.push("```");
    } else {
      // Successful tool executions collapse to one line to keep transcripts readable.
      lines.push(`- **Tool** (${name}): ${collapseToOneLine(rawContent)}`);
    }
  }

  return lines.join("\n");
}

// Formats an entire session into a Markdown document suitable for sharing.
export function formatExportMarkdown(session) {
  const { name, title, model, turnCount, time, history } = extractSessionMeta(session);
  const lines = [];

  // Header carries required provenance metadata.
  lines.push(`# Session: ${title}`);
  lines.push("");
  lines.push(`- **Session**: @${name}`);
  lines.push(`- **Title**: ${title}`);
  lines.push(`- **Model**: ${model}`);
  lines.push(`- **Turns**: ${turnCount}`);
  lines.push(`- **Time**: ${time}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  const lastToolCalls = new Map();

  for (const row of history) {
    if (!row || typeof row !== "object") continue;

    if (row.role === "user") {
      lines.push("### User");
      lines.push("");
      lines.push(String(row.text ?? row.content ?? "").trim());
      lines.push("");
    } else if (row.role === "assistant") {
      // Map tool use IDs to tool names so subsequent tool result rows can resolve names.
      if (Array.isArray(row.toolUses)) {
        for (const call of row.toolUses) {
          if (call?.id) lastToolCalls.set(String(call.id), String(call.name || "tool"));
        }
      }
      lines.push("### Assistant");
      lines.push("");
      const text = String(row.text ?? row.content ?? "").trim();
      if (text) lines.push(text);
      lines.push("");
    } else if (row.role === "tool") {
      const formatted = formatToolRow(row, lastToolCalls);
      if (formatted) {
        lines.push(formatted);
        lines.push("");
      }
    } else if (row.role === "agent") {
      const sender = row.senderLabel ? `@${row.senderLabel}` : "Agent";
      lines.push(`### Agent (${sender})`);
      lines.push("");
      lines.push(String(row.text ?? row.content ?? "").trim());
      lines.push("");
    }
  }

  // Zero ANSI escapes are guaranteed across the entire formatted output.
  return stripAnsi(lines.join("\n").trimEnd()) + "\n";
}

// Parses slash command arguments for /export flags.
export function parseExportArgs(args = []) {
  const flags = {
    markdown: false,
    force: false,
    outFile: null,
    ref: null,
  };
  const list = Array.isArray(args) ? args : [args].filter(Boolean);
  for (let i = 0; i < list.length; i += 1) {
    const a = String(list[i] || "");
    if (a === "--markdown" || a === "-md") {
      flags.markdown = true;
    } else if (a === "--force" || a === "-f") {
      flags.force = true;
    } else if (a === "--out") {
      if (list[i + 1] && !list[i + 1].startsWith("-")) {
        flags.outFile = String(list[i + 1]);
        i += 1;
      }
    } else if (a.startsWith("--out=")) {
      flags.outFile = a.slice(6);
    } else if (!a.startsWith("-") && !flags.ref) {
      flags.ref = a;
    }
  }
  return flags;
}

// Safely writes markdown export to disk, refusing to clobber existing files without force.
export function writeExportFile(filePath, content, { force = false } = {}) {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved) && !force) {
    throw new Error(`file already exists: ${filePath} (use --force to overwrite)`);
  }
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolved, content, "utf8");
  return resolved;
}
