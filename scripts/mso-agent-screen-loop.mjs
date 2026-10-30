import process from "node:process";
import { chromeLines } from "./mso-agent-chrome.mjs";
import { composerSeparator } from "./mso-agent-layout.mjs";
import { writeFrame } from "./mso-agent-screen.mjs";
import { transcriptLines } from "./mso-agent-transcript.mjs";
import {
  appendStream,
  commitStream,
  createViewport,
  handleViewportKey,
  resetFollow,
  setLines,
} from "./mso-agent-viewport.mjs";
import { renderViewport } from "./mso-agent-viewport-render.mjs";

// Rows kept below the panel for the composer prompt. The composer paints its own rows and cannot
// report them back, so the panel reserves a fixed block instead of guessing per repaint.
const PROMPT_ROWS = 3;

/**
 * Owns the alternate-screen panel: the transcript viewport, its chrome, and the key interception
 * that scrolls it. Everything here is inert when the alternate screen is off, so the inline path
 * keeps running exactly as it did before this module existed.
 *
 * @param {{
 *   session: any,
 *   enabled?: boolean,
 *   output?: any,
 *   input?: any,
 *   colors?: any,
 *   getSessions?: () => Array<any>,
 * }} options
 */
export function mountScreenLoop({
  session,
  enabled = false,
  output = process.stdout,
  input = process.stdin,
  colors = {},
  getSessions = () => [],
} = {}) {
  if (!enabled || !session) {
    return {
      active: false,
      paint() {},
      sync() {},
      follow() {},
      dispose() {},
    };
  }

  const viewport = createViewport({ rows: output.rows || 24 });
  let painted = [];
  let keysPatched = false;
  let originalEmit = null;

  const geometry = () => {
    const cols = Math.max(20, Number(output.columns) || 80);
    const rows = Math.max(6, Number(output.rows) || 24);
    const chrome = chromeLines({
      session,
      sessions: getSessions(),
      activeId: session.agentSession?.id,
      colors,
      width: cols,
      rows: null,
    });
    const separator = composerSeparator(session, colors, cols);
    // The separator belongs to the panel in this mode; the composer is told to draw none.
    const panel = [typeof separator === "string" ? separator : "", ...chrome].filter((line) => line.length > 0);
    return { cols, rows, panel, viewRows: Math.max(0, rows - panel.length - PROMPT_ROWS) };
  };

  // Repaints from the top of the screen and leaves the cursor where the composer expects to start,
  // because the composer paints relative to the cursor and cannot be told where to begin.
  const paint = () => {
    if (output?.isTTY !== true) return;
    const { cols, panel, viewRows } = geometry();
    const body = renderViewport(viewport, { colors, width: cols, rows: viewRows });
    const frame = [...body, ...panel, ""];
    output.write("\x1b[H");
    painted = writeFrame(output, painted, frame);
    output.write(`\x1b[${frame.length};1H`);
  };

  const sync = () => {
    commitStream(viewport);
    setLines(viewport, transcriptLines(session, { colors, width: output.columns || 80 }));
    paint();
  };

  // Streaming text goes into the buffer and repaints, so a long answer does not wait for the turn
  // to end before it becomes visible.
  session.streamSink = {
    write(chunk) {
      appendStream(viewport, chunk);
      paint();
    },
  };

  const onResize = () => {
    viewport.rows = output.rows || 24;
    paint();
  };
  output.on?.("resize", onResize);

  // readline emits keypress on stdin, and the composer is one of its listeners. Intercepting emit
  // is the only way to consume a key before the composer acts on it without growing the composer,
  // which sits at its line ceiling.
  originalEmit = input.emit;
  if (typeof originalEmit === "function") {
    keysPatched = true;
    input.emit = function patchedEmit(event, ...args) {
      if (event === "keypress" && args[1] && handleViewportKey(viewport, args[1], { rows: geometry().viewRows })) {
        paint();
        return true;
      }
      return Reflect.apply(originalEmit, this, [event, ...args]);
    };
  }

  setLines(viewport, transcriptLines(session, { colors, width: output.columns || 80 }));
  paint();

  return {
    active: true,
    paint,
    sync,
    follow: () => resetFollow(viewport),
    dispose() {
      output.off?.("resize", onResize);
      if (keysPatched) input.emit = originalEmit;
      if (session.streamSink) delete session.streamSink;
      // The panel owns the whole screen, so the inline transcript is repainted once on the way out
      // instead of leaving the alternate buffer's last frame on screen.
      painted = [];
    },
  };
}
