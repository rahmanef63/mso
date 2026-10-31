import { border, paneRow } from "./tui/cells.mjs";
import { latestTodos } from "./mso-agent-todos.mjs";
import { parseEditResult } from "./mso-agent-edit-diff.mjs";

const KINDS = ["todos", "diff", "files", "off"];

export function paneKinds() {
  return [...KINDS];
}

export function cyclePane(kind) {
  const idx = KINDS.indexOf(kind);
  return idx === -1 ? KINDS[0] : KINDS[(idx + 1) % KINDS.length];
}

// Side pane width: floor 30 preserves readability; ceiling 50 avoids crowding
// the transcript; fraction 0.35 reserves roughly two thirds for the transcript.
export function paneWidth(columns, { minColumns = 100 } = {}) {
  const cols = Number(columns) || 0;
  if (cols < minColumns) return 0;
  return Math.max(30, Math.min(50, Math.floor(cols * 0.35)));
}

function resolveTodos(todos, session) {
  if (todos != null) return todos;
  if (session?.todos != null) return session.todos;
  return latestTodos();
}

function resolveDiff(lastDiff, session) {
  if (lastDiff != null) return lastDiff;
  if (session?.lastDiff != null) return session.lastDiff;
  const history = Array.isArray(session?.history) ? session.history : (session?.agentSession?.history || []);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (!row || typeof row !== "object") continue;
    const results = Array.isArray(row.results) ? row.results : (row.result != null || row.content != null ? [row] : []);
    for (const res of results) {
      const parsed = parseEditResult(res?.content ?? res);
      if (parsed) return parsed;
    }
  }
  return null;
}

function resolveFiles(files, session) {
  if (Array.isArray(files) && files.length > 0) return files;
  if (Array.isArray(session?.changedFiles) && session.changedFiles.length > 0) return session.changedFiles;
  const history = Array.isArray(session?.history) ? session.history : (session?.agentSession?.history || []);
  const seen = new Set(), list = [];
  for (const row of history) {
    if (!row || typeof row !== "object") continue;
    if (Array.isArray(row.toolUses)) {
      for (const call of row.toolUses) {
        if (["fs_edit", "fs_write", "fs_replace"].includes(String(call?.name || "")) && call?.input?.path) {
          const p = String(call.input.path);
          if (!seen.has(p)) { seen.add(p); list.push(p); }
        }
      }
    }
    const results = Array.isArray(row.results) ? row.results : (row.result != null || row.content != null ? [row] : []);
    for (const res of results) {
      const parsed = parseEditResult(res?.content ?? res);
      if (parsed?.path && !seen.has(String(parsed.path))) {
        seen.add(String(parsed.path));
        list.push(String(parsed.path));
      }
    }
  }
  return list;
}

function formatKindContent({ kind, session, todos, lastDiff, files }) {
  if (kind === "todos") {
    const state = resolveTodos(todos, session);
    const items = Array.isArray(state?.items) ? state.items : [];
    if (!items.length && !state?.summary) return { title: "Todos", emptyText: "no todos in this session", rows: [] };
    const rows = items.map((it) => ({
      text: it.status === "completed" ? `[x] ${it.content}` : it.status === "in_progress" ? `[~] ${it.activeForm || it.content}` : `[ ] ${it.content}`,
      tone: it.status === "completed" ? "dim" : it.status === "in_progress" ? "active" : "normal",
    }));
    if (state?.summary && typeof state.summary.count === "number" && typeof state.summary.completed === "number") {
      rows.push({ text: `${state.summary.completed}/${state.summary.count} done`, tone: "dim" });
    }
    return { title: "Todos", emptyText: null, rows };
  }

  if (kind === "diff") {
    const diffObj = resolveDiff(lastDiff, session);
    if (!diffObj || typeof diffObj.diff !== "string") return { title: "Last edit diff", emptyText: "no edits in this session", rows: [] };
    const raw = diffObj.diff.replace(/\r/g, "");
    const diffLines = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : (raw ? raw.split("\n") : []);
    if (!diffLines.length) return { title: "Last edit diff", emptyText: "no edits in this session", rows: [] };
    const base = (diffObj.path ? diffObj.path.split(/[/\\]/).filter(Boolean).pop() : null) || "file";
    const rows = [{ text: `edit ${base}`, tone: "header" }];
    for (const dl of diffLines) {
      const tone = dl.startsWith("+") ? "add" : dl.startsWith("-") ? "del" : dl.startsWith("@@") ? "hunk" : "normal";
      rows.push({ text: dl, tone });
    }
    return { title: "Last edit diff", emptyText: null, rows };
  }

  if (kind === "files") {
    const fileList = resolveFiles(files, session);
    if (!fileList.length) return { title: "Changed files", emptyText: "no changed files", rows: [] };
    return { title: "Changed files", emptyText: null, rows: fileList.map((f) => ({ text: f, tone: "normal" })) };
  }

  return { title: "Pane off", emptyText: "pane is off", rows: [] };
}

function styleTone(line, tone, { colors, cDim, cCyan, cErr, cBlue, cBold }) {
  if (!colors || Object.keys(colors).length === 0) return line;
  const reset = colors.reset || "";
  if (tone === "dim" && cDim) return `${cDim}${line}${reset}`;
  if ((tone === "active" || tone === "add") && cCyan) return `${cCyan}${line}${reset}`;
  if (tone === "del" && cErr) return `${cErr}${line}${reset}`;
  if (tone === "hunk" && cBlue) return `${cBlue}${line}${reset}`;
  if (tone === "header" && cBold) return `${cBold}${line}${reset}`;
  return line;
}

/**
 * @param {{
 *   kind?: string,
 *   session?: any,
 *   todos?: any,
 *   lastDiff?: any,
 *   files?: any,
 *   colors?: any,
 *   width?: number,
 *   rows?: number,
 * }} [options]
 */
export function paneLines({
  kind = "todos",
  session = null,
  todos = null,
  lastDiff = null,
  files = null,
  colors = {},
  width = 40,
  rows = 24,
} = {}) {
  const r = Math.max(0, Number(rows) || 0), w = Math.max(0, Number(width) || 0);
  if (r === 0 || w === 0) return [];
  if (w <= 2) return Array.from({ length: r }, () => (w === 1 ? "│" : "││"));

  const widths = [w - 2], hasColors = Boolean(colors && Object.keys(colors).length > 0);
  const palette = {
    colors,
    cDim: hasColors ? (colors.dim || "") : "",
    cReset: hasColors ? (colors.reset || "") : "",
    cBold: hasColors ? (colors.bold || "") : "",
    cCyan: hasColors ? (colors.cyan || colors.c || "") : "",
    cErr: hasColors ? (colors.err || "") : "",
    cBlue: hasColors ? (colors.blue || "") : "",
  };

  const { title, emptyText, rows: contentRows } = formatKindContent({ kind, session, todos, lastDiff, files });
  const topBorder = palette.cDim ? `${palette.cDim}${border(widths, "top")}${palette.cReset}` : border(widths, "top");
  const midBorder = palette.cDim ? `${palette.cDim}${border(widths, "mid")}${palette.cReset}` : border(widths, "mid");
  const botBorder = palette.cDim ? `${palette.cDim}${border(widths, "bottom")}${palette.cReset}` : border(widths, "bottom");
  const titleRow = palette.cBold ? `${palette.cBold}${paneRow([title], widths)}${palette.cReset}` : paneRow([title], widths);

  if (r === 1) return [titleRow];
  if (r === 2) return [topBorder, botBorder];
  if (r === 3) return [topBorder, titleRow, botBorder];
  if (r === 4) {
    const row = emptyText
      ? styleTone(paneRow([`(${emptyText})`], widths), "dim", palette)
      : (contentRows[0] ? styleTone(paneRow([contentRows[0].text], widths), contentRows[0].tone, palette) : paneRow([""], widths));
    return [topBorder, titleRow, row, botBorder];
  }

  const bodySlots = r - 4, out = [topBorder, titleRow, midBorder];
  if (emptyText) {
    const line = paneRow([`(${emptyText})`], widths);
    out.push(palette.cDim ? `${palette.cDim}${line}${palette.cReset}` : line);
    for (let i = 1; i < bodySlots; i += 1) out.push(paneRow([""], widths));
  } else {
    for (let i = 0; i < bodySlots; i += 1) {
      if (i < contentRows.length) {
        const item = contentRows[i];
        out.push(styleTone(paneRow([item.text], widths), item.tone, palette));
      } else {
        out.push(paneRow([""], widths));
      }
    }
  }
  out.push(botBorder);
  return out;
}
