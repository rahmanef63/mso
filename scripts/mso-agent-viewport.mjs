import { windowFor } from "./tui/cells.mjs";

const DEFAULT_MAX_LINES = 2000;

// Committed lines plus the in-flight stream line. Exported because the renderer needs the same
// definition and a second copy would drift.
export function getAllLines(viewport) {
  if (!viewport) return [];
  if (typeof viewport.stream === "string" && viewport.stream.length > 0) {
    return [...viewport.lines, viewport.stream];
  }
  return viewport.lines;
}

// Bounded viewport buffer holding committed history and partial in-flight stream text.
// Offset 0 denotes follow mode (pinned to the bottom).
export function createViewport({ rows = 24, maxLines = DEFAULT_MAX_LINES } = {}) {
  return {
    lines: [], stream: "", offset: 0,
    rows: Math.max(0, Number(rows) || 24),
    maxLines: Math.max(10, Number(maxLines) || DEFAULT_MAX_LINES),
    droppedCount: 0,
  };
}

// Resets scroll offset to zero to re-enable follow mode when a new prompt is submitted.
export function resetFollow(viewport) {
  if (viewport) viewport.offset = 0;
}

// Appends complete lines to the buffer, preserving viewport position if scrolled up.
export function appendLines(viewport, lines) {
  if (!viewport || !lines) return;
  const input = Array.isArray(lines) ? lines : [lines];
  const flattened = [];
  for (const item of input) {
    const parts = String(item ?? "").replace(/\r/g, "").split("\n");
    for (const p of parts) flattened.push(p);
  }
  if (flattened.length === 0) return;
  if (viewport.offset > 0) viewport.offset += flattened.length;
  for (const line of flattened) viewport.lines.push(line);

  enforceCap(viewport);
}

// Drops the oldest lines past the cap and leaves a marker, so a long session cannot exhaust
// memory and the reader can still see that something was dropped.
function enforceCap(viewport) {
  if (viewport.lines.length <= viewport.maxLines) return;
  const excess = viewport.lines.length - viewport.maxLines + 1;
  viewport.droppedCount += excess;
  viewport.lines.splice(0, excess);
  const dropMarker = `[... ${viewport.droppedCount} earlier lines dropped ...]`;
  if (viewport.lines.length > 0 && viewport.lines[0].startsWith("[... ") && viewport.lines[0].endsWith(" dropped ...]")) {
    viewport.lines[0] = dropMarker;
  } else {
    viewport.lines.unshift(dropMarker);
  }
  const maxOffset = Math.max(0, getAllLines(viewport).length - viewport.rows);
  viewport.offset = Math.min(viewport.offset, maxOffset);
}

// Replaces the committed lines with a transcript derived again from history. Replacing, not
// appending, because the transcript is recomputed every turn and history can be compacted or
// resumed: an appended buffer would duplicate lines or keep ones that no longer exist.
export function setLines(viewport, lines) {
  if (!viewport) return;
  const flat = [];
  for (const item of Array.isArray(lines) ? lines : [lines]) {
    for (const part of String(item ?? "").replace(/\r/g, "").split("\n")) flat.push(part);
  }
  const wasFollowing = viewport.offset === 0;
  viewport.lines = flat;
  viewport.droppedCount = 0;
  enforceCap(viewport);
  if (wasFollowing) viewport.offset = 0;
}

// Ingests streaming chunks, buffering partial trailing lines without committing them prematurely.
export function appendStream(viewport, chunk) {
  if (!viewport) return;
  const combined = (viewport.stream || "") + String(chunk ?? "").replace(/\r/g, "");
  const parts = combined.split("\n");
  viewport.stream = parts.pop() ?? "";
  if (parts.length > 0) appendLines(viewport, parts);
}

// Commits any pending stream text as a permanent line once turn generation concludes.
export function commitStream(viewport) {
  if (!viewport) return;
  if (typeof viewport.stream === "string" && viewport.stream.length > 0) {
    const trailing = viewport.stream;
    viewport.stream = "";
    appendLines(viewport, [trailing]);
  }
}

// Computes the visible window using windowFor semantics to prevent duplicate boundary code.
export function viewportWindow(viewport, rows) {
  const r = Math.max(0, Number(rows ?? viewport?.rows) || 0);
  const allLines = getAllLines(viewport);
  const total = allLines.length;

  if (r === 0 || total === 0) {
    return { lines: [], offset: 0, total, follow: viewport?.offset === 0, start: 0, end: 0 };
  }
  if (total <= r) {
    return { lines: [...allLines], offset: 0, total, follow: true, start: 0, end: total };
  }

  const maxOffset = total - r;
  const clampedOffset = Math.max(0, Math.min(viewport.offset, maxOffset));
  const targetStart = total - r - clampedOffset;
  const { start, end } = windowFor(allLines, targetStart + Math.floor(r / 2), r);
  return {
    lines: allLines.slice(start, end),
    offset: clampedOffset,
    total,
    follow: clampedOffset === 0,
    start,
    end,
  };
}

// Handles scroll navigation keys, returning true only if the key was recognized and consumed.
export function handleViewportKey(viewport, key, { rows } = {}) {
  if (!viewport || !key || typeof key !== "object") return false;
  const r = Math.max(1, Number(rows ?? viewport.rows) || 1);
  const total = getAllLines(viewport).length;
  const maxOffset = Math.max(0, total - r);
  const halfPage = Math.max(1, Math.floor(r / 2));

  if (key.name === "pageup") {
    viewport.offset = Math.min(maxOffset, viewport.offset + r);
    return true;
  }
  if (key.name === "pagedown") {
    viewport.offset = Math.max(0, viewport.offset - r);
    return true;
  }
  if (key.ctrl && (key.name === "g" || key.name === "G") && !key.shift) {
    viewport.offset = maxOffset;
    return true;
  }
  if (((key.ctrl && key.shift) && (key.name === "g" || key.name === "G")) || key.name === "end") {
    viewport.offset = 0;
    return true;
  }
  if (key.ctrl && key.name === "u") {
    viewport.offset = Math.min(maxOffset, viewport.offset + halfPage);
    return true;
  }
  if (key.ctrl && key.name === "d") {
    viewport.offset = Math.max(0, viewport.offset - halfPage);
    return true;
  }
  return false;
}
