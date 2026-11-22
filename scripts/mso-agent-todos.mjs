import process from "node:process";
import { fit } from "./mso-agent-ui.mjs";
import { createPrinter } from "./mso-agent-print.mjs";

const VALID_STATUSES = new Set(["pending", "in_progress", "completed"]);

let cachedTodos = null;

/**
 * Drop the cache. A new or resumed session must not inherit the previous checklist, because the
 * status row would then describe work that belongs to a different session.
 */
export function clearTodos() {
  cachedTodos = null;
}

export const resetTodosForTesting = clearTodos;

/**
 * Parse input.todos array and result summary string without throwing.
 * Returns null when neither usable items nor a valid summary are present.
 */
export function parseTodoCall(input, result) {
  let items = null;
  if (input && typeof input === "object" && Array.isArray(input.todos)) {
    const validItems = [];
    for (const item of input.todos) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      if (typeof item.content !== "string") continue;
      const content = item.content.trim();
      if (!content || !VALID_STATUSES.has(item.status)) continue;

      const cleanItem = {
        content,
        status: item.status,
      };
      if (typeof item.activeForm === "string" && item.activeForm.trim()) {
        cleanItem.activeForm = item.activeForm.trim();
      }
      validItems.push(cleanItem);
    }
    if (validItems.length > 0) {
      items = validItems;
    }
  }

  let summary = null;
  if (result != null) {
    let parsed = result;
    if (typeof result === "string") {
      try {
        parsed = JSON.parse(result);
      } catch {
        parsed = null;
      }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (typeof parsed.count === "number" && typeof parsed.completed === "number") {
        summary = {
          ok: true,
          count: parsed.count,
          inProgress: typeof parsed.inProgress === "string" ? parsed.inProgress : null,
          completed: parsed.completed,
          pending: typeof parsed.pending === "number" ? parsed.pending : Math.max(0, parsed.count - parsed.completed),
        };
      }
    }
  }

  if (!items && !summary) {
    return null;
  }

  return {
    items: items || [],
    summary,
  };
}

/**
 * Cache the latest non-null state in memory across turn boundaries.
 */
export function rememberTodos(state) {
  if (state != null) {
    cachedTodos = state;
  }
  return state;
}

/**
 * Retrieve the cached todo state.
 */
export function latestTodos() {
  return cachedTodos;
}

/**
 * Format the checklist block for terminal output.
 * Uses plain dimming without strike codes because strike escapes (\\x1b[9m) render inconsistently
 * or corrupt glyphs on legacy Windows emulators.
 */
export function formatTodoBlock(state, { colors = {}, maxItems = 12, columns } = {}) {
  if (!state) return "";
  const items = Array.isArray(state.items) ? state.items : [];
  if (!items.length && !state.summary) return "";

  const termCols = Math.max(24, Number(columns ?? process.stdout?.columns ?? 80));
  const accent = colors?.c || colors?.cyan || colors?.blue || "";
  const dim = colors?.dim || "";
  const reset = (accent || dim) ? (colors?.reset || "\x1b[0m") : "";

  const indent = "  ";
  // Reserve 6 columns for two spaces of indentation and four-column status markers like "[x] ".
  const textBudget = Math.max(10, termCols - 6);

  const lines = [];
  // `--all` passes Infinity; only a missing or negative cap falls back to the default, otherwise
  // asking for everything would quietly render twelve rows.
  const effectiveMax = typeof maxItems === "number" && maxItems >= 0 ? maxItems : 12;
  const renderCount = Math.min(items.length, effectiveMax);

  for (let i = 0; i < renderCount; i++) {
    const item = items[i];
    if (item.status === "completed") {
      const text = fit(item.content, textBudget);
      const row = `[x] ${text}`;
      lines.push(`${indent}${dim ? `${dim}${row}${reset}` : row}`);
    } else if (item.status === "in_progress") {
      const text = fit(item.activeForm || item.content, textBudget);
      const marker = accent ? `${accent}[~]${reset}` : "[~]";
      lines.push(`${indent}${marker} ${text}`);
    } else {
      const text = fit(item.content, textBudget);
      lines.push(`${indent}[ ] ${text}`);
    }
  }

  if (items.length > effectiveMax) {
    const withheld = items.length - effectiveMax;
    const withheldText = `… ${withheld} more items`;
    lines.push(`${indent}${dim ? `${dim}${withheldText}${reset}` : withheldText}`);
  }

  if (state.summary && typeof state.summary.count === "number" && typeof state.summary.completed === "number") {
    const progressText = `${state.summary.completed}/${state.summary.count} done`;
    lines.push(`${indent}${dim ? `${dim}${progressText}${reset}` : progressText}`);
  }

  return lines.join("\n");
}

/**
 * Format a compact status chip showing progress and active task.
 */
export function todoStatusChip(state = cachedTodos) {
  if (!state) return null;

  const summary = state.summary;
  const items = Array.isArray(state.items) ? state.items : [];

  let count = summary?.count ?? items.length;
  let completed = summary?.completed ?? items.filter((i) => i.status === "completed").length;

  if (count <= 0) return null;

  const activeItem = items.find((i) => i.status === "in_progress");
  const activeText = activeItem ? (activeItem.activeForm || activeItem.content) : (summary?.inProgress || null);

  const progress = `${completed}/${count}`;
  if (activeText) {
    // Cap label to 24 characters to prevent horizontal wrapping on tight status rows.
    return `todos ${progress} · ${fit(activeText, 24)}`;
  }
  return `todos ${progress}`;
}

/**
 * Print the formatted todo block via a designated sink.
 */
export function printTodoBlock(state, { colors, maxItems, print, activity, session } = {}) {
  const formatted = formatTodoBlock(state, { colors, maxItems });
  if (!formatted) return false;
  const doPrint = print || createPrinter({ session, colors }).printBlock;
  if (activity?.live) {
    activity.clear();
    const tone = colors?.c || colors?.cyan || "";
    const reset = colors?.reset || "";
    doPrint(`${tone}  ✓ todo_write${reset}`);
  }
  doPrint(formatted);
  return true;
}
