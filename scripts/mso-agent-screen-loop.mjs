import process from "node:process";
import { chromeLines, tabAtPoint } from "./mso-agent-chrome.mjs";
import { composerSeparator } from "./mso-agent-layout.mjs";
import { disableMouse, enableMouse, handleMouse, parseMouseChunk } from "./mso-agent-mouse.mjs";
import { writeFrame } from "./mso-agent-screen.mjs";
import { transcriptLines } from "./mso-agent-transcript.mjs";
import { appendStream, commitStream, createViewport, handleViewportKey, resetFollow, setLines } from "./mso-agent-viewport.mjs";
import { renderViewport } from "./mso-agent-viewport-render.mjs";
import { paneLines, paneWidth } from "./mso-agent-pane.mjs";
import { clampPromptRows, PROMPT_ROWS } from "./mso-agent-composer-ui.mjs";
export { clampPromptRows, PROMPT_ROWS } from "./mso-agent-composer-ui.mjs";

/**
 * Owns the alternate-screen panel: the transcript viewport, its chrome, and key and mouse
 * interception. Everything here is inert when the alternate screen is off, so the inline path
 * keeps running exactly as it did before this module existed.
 *
 * @param {{
 *   session: any,
 *   enabled?: boolean,
 *   output?: any,
 *   input?: any,
 *   colors?: any,
 *   getSessions?: () => Array<any>,
 *   onTabClick?: (sessionId: string) => void | Promise<void>,
 * }} options
 */
export function mountScreenLoop({
  session,
  enabled = false,
  output = process.stdout,
  input = process.stdin,
  colors = {},
  getSessions = () => [],
  onTabClick,
  composer = null,
} = {}) {
  if (!enabled || !session) {
    return {
      active: false,
      paint() {},
      sync() {},
      follow() {},
      geometry() { return { cols: 80, rows: 24, panel: [], viewRows: 0, tabRowY: 0, pWidth: 0, transWidth: 80, kind: null, promptRows: PROMPT_ROWS }; },
      setPromptRows() {},
      dispose() {},
    };
  }

  enableMouse(output);

  const onTeardown = () => { disableMouse(output); };
  const detach = (target, event, listener) => {
    if (typeof target?.off === "function") target.off(event, listener);
    else if (typeof target?.removeListener === "function") target.removeListener(event, listener);
  };
  ["exit", "SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => process.on?.(sig, onTeardown));

  const viewport = createViewport({ rows: output.rows || 24 });
  let painted = [];
  let keysPatched = false;
  let originalEmit = null;
  let promptReservation = PROMPT_ROWS;

  const setPromptRows = (rows) => {
    // When the composer reports its painted row count, clamp it so the panel
    // never jumps on erase (0) and never gets pushed off screen by tall drafts.
    const termRows = Math.max(6, Number(output.rows) || 24);
    const clamped = clampPromptRows(rows, termRows);
    if (clamped !== promptReservation) {
      promptReservation = clamped;
      paint();
    }
  };

  if (composer) {
    if (typeof composer.onRows === "function") composer.onRows(setPromptRows);
    else composer.onRows = setPromptRows;
  }
  if (session) {
    session.onComposerRows = setPromptRows;
  }

  const geometry = (reservation = promptReservation) => {
    const cols = Math.max(20, Number(output.columns) || 80);
    const rows = Math.max(6, Number(output.rows) || 24);
    const chrome = chromeLines({ session, sessions: getSessions(), activeId: session.agentSession?.id, colors, width: cols, rows: null });
    const separator = composerSeparator(session, colors, cols);
    const hasSep = typeof separator === "string" && separator.length > 0;
    // The separator belongs to the panel in this mode; the composer is told to draw none.
    const panel = [hasSep ? separator : "", ...chrome].filter((line) => line.length > 0);
    const viewRows = Math.max(0, rows - panel.length - reservation);
    const tabRowY = viewRows + (hasSep ? 1 : 0);
    const kind = session?.paneKind && session.paneKind !== "off" ? session.paneKind : null;
    const pWidth = kind ? paneWidth(cols) : 0;
    const transWidth = cols - pWidth;
    return { cols, rows, panel, viewRows, tabRowY, pWidth, transWidth, kind, promptRows: reservation };
  };

  // Repaints from the top of the screen and leaves the cursor where the composer expects to start,
  // because the composer paints relative to the cursor and cannot be told where to begin.
  const paint = () => {
    if (output?.isTTY !== true) return;
    const { panel, viewRows, pWidth, transWidth, kind } = geometry();
    const body = renderViewport(viewport, { colors, width: transWidth, rows: viewRows });
    const side = pWidth > 0 ? paneLines({ kind, session, colors, width: pWidth, rows: viewRows }) : [];
    const joined = pWidth > 0 ? body.map((line, i) => `${line}${side[i] || ""}`) : body;
    const frame = [...joined, ...panel, ""];
    output.write("\x1b[H");
    painted = writeFrame(output, painted, frame);
    output.write(`\x1b[${frame.length};1H`);
  };

  const sync = () => {
    commitStream(viewport);
    setLines(viewport, transcriptLines(session, { colors, width: geometry().transWidth }));
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
    sync();
  };
  output.on?.("resize", onResize);

  const dispatchMouse = (event) => {
    if (!event) return false;
    if (event.kind === "wheel") {
      if (handleMouse(viewport, event, { rows: geometry().viewRows })) { paint(); return true; }
      return false;
    }
    if (event.kind === "click") {
      const { cols, tabRowY } = geometry();
      if (event.y === tabRowY) {
        const targetId = tabAtPoint(getSessions(), session?.agentSession?.id, { x: event.x, y: event.y, width: cols, tabRow: tabRowY });
        if (targetId && typeof onTabClick === "function") {
          Promise.resolve(onTabClick(targetId)).then(paint).catch(() => {});
          return true;
        }
      }
      return true;
    }
    return false;
  };

  // readline emits keypress on stdin, and the composer is one of its listeners. Intercepting emit
  // is the only way to consume keys and mouse sequences before the composer acts on them without
  // growing the composer, which sits at its line ceiling.
  originalEmit = input.emit;
  if (typeof originalEmit === "function") {
    keysPatched = true;
    input.emit = function patchedEmit(event, ...args) {
      if (event === "data" && args[0]) {
        const chunk = typeof args[0] === "string" ? args[0] : (args[0] instanceof Buffer ? args[0].toString("utf8") : "");
        if (chunk.includes("\x1b[<")) {
          const events = parseMouseChunk(chunk);
          if (events.length > 0) {
            for (const ev of events) dispatchMouse(ev);
            const stripped = chunk.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "");
            if (!stripped) return true;
            args[0] = typeof args[0] === "string" ? stripped : Buffer.from(stripped, "utf8");
          }
        }
      }
      if (event === "keypress") {
        const seq = args[1]?.sequence || (typeof args[0] === "string" ? args[0] : "");
        if (typeof seq === "string" && seq.startsWith("\x1b[<")) {
          const events = parseMouseChunk(seq);
          if (events.length > 0) {
            for (const ev of events) dispatchMouse(ev);
            return true;
          }
        }
        if (args[1] && handleViewportKey(viewport, args[1], { rows: geometry().viewRows })) {
          paint();
          return true;
        }
      }
      return Reflect.apply(originalEmit, this, [event, ...args]);
    };
  }

  setLines(viewport, transcriptLines(session, { colors, width: geometry().transWidth }));
  paint();

  return {
    active: true,
    paint,
    sync,
    follow: () => resetFollow(viewport),
    geometry,
    setPromptRows,
    dispose() {
      ["exit", "SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => detach(process, sig, onTeardown));
      output.off?.("resize", onResize);
      if (keysPatched) input.emit = originalEmit;
      disableMouse(output);
      if (session.streamSink) delete session.streamSink;
      if (session.onComposerRows) delete session.onComposerRows;
      // The panel owns the whole screen, so the inline transcript is repainted once on the way out
      // instead of leaving the alternate buffer's last frame on screen.
      painted = [];
    },
  };
}
