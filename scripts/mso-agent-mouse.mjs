import { getAllLines } from "./mso-agent-viewport.mjs";

// SGR extended mouse reporting sequences. Normal 1000 mode reports button press and release;
// 1006 extended mode reports coordinates beyond column 223 using decimal SGR encoding.
export const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
export const MOUSE_OFF = "\x1b[?1006l\x1b[?1000l";

// Tracks active outputs currently configured for mouse reporting.
const activeOutputs = new Set();

/**
 * Enables SGR mouse reporting idempotently on the output stream.
 * Suppresses write errors so failing streams do not throw.
 *
 * @param {any} output
 * @returns {boolean}
 */
export function enableMouse(output) {
  if (!output || typeof output.write !== "function") return false;
  if (activeOutputs.has(output)) return false;
  try {
    output.write(MOUSE_ON);
    activeOutputs.add(output);
    return true;
  } catch {
    return false;
  }
}

/**
 * Disables SGR mouse reporting idempotently on the output stream.
 * Tolerant of partial writes and does not throw when write fails.
 *
 * @param {any} [output]
 * @returns {boolean}
 */
export function disableMouse(output) {
  if (output) {
    if (!activeOutputs.has(output)) return false;
    activeOutputs.delete(output);
    if (typeof output.write !== "function") return false;
    try {
      output.write(MOUSE_OFF);
      return true;
    } catch {
      return false;
    }
  }

  if (activeOutputs.size === 0) return false;
  let disabled = false;
  for (const stream of [...activeOutputs]) {
    activeOutputs.delete(stream);
    if (typeof stream?.write === "function") {
      try {
        stream.write(MOUSE_OFF);
        disabled = true;
      } catch {
        // Suppress write errors to allow remaining teardown to complete.
      }
    }
  }
  return disabled;
}

/**
 * Parses an input chunk containing SGR mouse sequences (\x1b[<CB;Cx;Cy[Mm]).
 * Returns an array of parsed mouse event objects, or [] if no sequence is found.
 *
 * @param {any} chunk
 * @returns {Array<{ kind: "wheel" | "click" | "release" | "other", button: string, x: number, y: number, shift: boolean, alt: boolean, ctrl: boolean }>}
 */
export function parseMouseChunk(chunk) {
  if (chunk == null) return [];
  const raw = typeof chunk === "string" ? chunk : (Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
  if (!raw.includes("\x1b[<")) return [];

  const events = [];
  const regex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    const code = Number.parseInt(match[1], 10);
    const rawX = Number.parseInt(match[2], 10);
    const rawY = Number.parseInt(match[3], 10);
    const finalChar = match[4];

    if (Number.isNaN(code) || Number.isNaN(rawX) || Number.isNaN(rawY)) continue;

    // Coordinates are 1-based as the terminal sends them; converted to 0-based rows/columns here.
    const x = Math.max(0, rawX - 1);
    const y = Math.max(0, rawY - 1);

    const shift = Boolean(code & 4);
    const alt = Boolean(code & 8);
    const ctrl = Boolean(code & 16);

    const isWheel = (code & 64) !== 0;

    let kind = "other";
    let button = "unknown";

    if (isWheel) {
      kind = "wheel";
      const dir = code & 3;
      if (dir === 0) button = "up";
      else if (dir === 1) button = "down";
      else if (dir === 2) button = "left";
      else if (dir === 3) button = "right";
    } else if (finalChar === "m") {
      kind = "release";
      const btn = code & 3;
      if (btn === 0) button = "left";
      else if (btn === 1) button = "middle";
      else if (btn === 2) button = "right";
      else button = "release";
    } else if ((code & 32) !== 0) {
      kind = "other";
      button = "motion";
    } else {
      kind = "click";
      const btn = code & 3;
      if (btn === 0) button = "left";
      else if (btn === 1) button = "middle";
      else if (btn === 2) button = "right";
      else button = "unknown";
    }

    events.push({ kind, button, x, y, shift, alt, ctrl });
  }

  return events;
}

/**
 * Handles mouse wheel scrolling for the transcript viewport.
 * Wheel up scrolls up by 3 lines; wheel down scrolls down by 3 lines.
 * Returns true when the event was consumed.
 *
 * @param {any} scroll
 * @param {any} event
 * @param {{ rows?: number, onScroll?: (offset: number) => void }} [options]
 * @returns {boolean}
 */
export function handleMouse(scroll, event, { rows, onScroll } = {}) {
  if (!scroll || !event || event.kind !== "wheel") return false;

  if (event.button === "up") {
    const maxOffset = Array.isArray(scroll?.lines) && scroll.lines.length > 0
      ? Math.max(0, getAllLines(scroll).length - Math.max(1, Number(rows ?? scroll.rows) || 1))
      : Number.POSITIVE_INFINITY;
    scroll.offset = Math.min(maxOffset, (scroll.offset || 0) + 3);
    if (typeof onScroll === "function") onScroll(scroll.offset);
    return true;
  }

  if (event.button === "down") {
    scroll.offset = Math.max(0, (scroll.offset || 0) - 3);
    if (typeof onScroll === "function") onScroll(scroll.offset);
    return true;
  }

  return false;
}
