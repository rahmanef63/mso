import process from "node:process";
import { chromeLines, tabAtPoint } from "./mso-agent-chrome.mjs";
import { composerSeparator } from "./mso-agent-layout.mjs";
import { disableMouse, enableMouse, handleMouse } from "./mso-agent-mouse.mjs";
import { installInputHook } from "./mso-agent-input-hook.mjs";
import { createPanelSuspension } from "./mso-agent-panel-suspend.mjs";
import { writeFrame } from "./mso-agent-screen.mjs";
import { transcriptLines } from "./mso-agent-transcript.mjs";
import { appendStream, commitStream, createViewport, handleViewportKey, resetFollow, setLines } from "./mso-agent-viewport.mjs";
import { renderViewport } from "./mso-agent-viewport-render.mjs";
import { paneLines, paneWidth } from "./mso-agent-pane.mjs";
import { withPreamble } from "./mso-agent-banner-lines.mjs";
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
 *   preamble?: (() => Array<string> | null) | null,
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
  preamble = null,
} = {}) {
  if (!enabled || !session) {
    return {
      active: false,
      session: null,
      paint() {},
      sync() {},
      suspend() {},
      resume() {},
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
  let promptReservation = PROMPT_ROWS;

  const setPromptRows = (rows) => {
    // When the composer reports its painted row count, clamp it so the panel never jumps on erase
    // and never gets pushed off screen by a tall draft.
    //
    // Deliberately does NOT repaint here. The composer calls this WHILE it is painting its own draft
    // and completion menu, so painting the panel from home would erase both: pressing "/" showed the
    // draft and the whole command menu vanish. The reservation is still updated, and the next
    // keypress or sync repaints with the new geometry.
    const termRows = Math.max(6, Number(output.rows) || 24);
    const clamped = clampPromptRows(rows, termRows);
    if (clamped !== promptReservation) promptReservation = clamped;
  };

  if (composer) {
    if (typeof composer.onRows === "function") composer.onRows(setPromptRows);
    else composer.onRows = setPromptRows;
  }
  session.onComposerRows = setPromptRows;

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
    setLines(viewport, withPreamble(preamble?.() ?? null, transcriptLines(session, { colors, width: geometry().transWidth })));
    paint();
  };

  // Streaming text goes into the buffer and repaints, so a long answer does not wait for the turn to
  // end before it becomes visible. Command output arrives as whole lines instead of chunks, so it is
  // committed immediately rather than left as a partial line.
  session.streamSink = { write(chunk) { appendStream(viewport, chunk); paint(); } };
  session.printSink = (line) => { appendStream(viewport, `${String(line ?? "")}\n`); commitStream(viewport); paint(); };

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

  const hook = installInputHook({
    input,
    onKey: (key) => {
      if (!handleViewportKey(viewport, key, { rows: geometry().viewRows })) return false;
      paint();
      return true;
    },
    onMouse: (event) => dispatchMouse(event),
  });

  const panelSuspend = createPanelSuspension({
    session, output, hook, onRepaint: paint, onReset: () => { painted = []; },
  });
  const suspend = panelSuspend.suspend;
  const resume = panelSuspend.resume;

  setLines(viewport, withPreamble(preamble?.() ?? null, transcriptLines(session, { colors, width: geometry().transWidth })));
  paint();

  const loop = {
    active: true,
    session,
    paint,
    sync,
    suspend,
    resume,
    follow: () => resetFollow(viewport),
    geometry,
    setPromptRows,
    dispose() {
      ["exit", "SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => detach(process, sig, onTeardown));
      output.off?.("resize", onResize);
      hook.dispose();
      disableMouse(output);
      if (session.streamSink) delete session.streamSink;
      if (session.printSink) delete session.printSink;
      if (session.onComposerRows) delete session.onComposerRows;
      if (session.screenLoop) delete session.screenLoop;
      // The panel owns the whole screen, so the inline transcript is repainted once on the way out
      // instead of leaving the alternate buffer's last frame on screen.
      painted = [];
    },
  };
  // An approval raised deep inside a tool call has to find the panel without a new parameter
  // threaded through every layer, so the loop announces itself on the session. dispose clears it.
  session.screenLoop = loop;
  return loop;
}

export function suspendScreenLoop(loop) { loop?.suspend?.(); }
export function resumeScreenLoop(loop) { loop?.resume?.(); }
