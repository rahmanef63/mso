import process from "node:process";
import { tabAtPoint, tabRailLines, tabRailWidth } from "./mso-agent-chrome.mjs";
import { disableMouse, enableMouse, handleMouse, isMouseEnabled, setMouseReporting } from "./mso-agent-mouse.mjs";
import { installInputHook } from "./mso-agent-input-hook.mjs";
import { createPanelSuspension } from "./mso-agent-panel-suspend.mjs";
import { panelGeometry } from "./mso-agent-panel-geometry.mjs";
import { writeFrame } from "./mso-agent-screen.mjs";
import { transcriptLines } from "./mso-agent-transcript.mjs";
import { appendStream, commitStream, createViewport, handleViewportKey, resetFollow, setLines } from "./mso-agent-viewport.mjs";
import { renderViewport } from "./mso-agent-viewport-render.mjs";
import { paneLines } from "./mso-agent-pane.mjs";
import { withPreamble } from "./mso-agent-banner-lines.mjs";
import { clampPromptRows, PROMPT_ROWS } from "./mso-agent-composer-ui.mjs";
import { createCompactionWatcher } from "./mso-agent-compaction.mjs";
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
 *   composer?: any,
 *   preamble?: (() => Array<string> | null) | null,
 *   tabsLayout?: string | null,
 *   mouse?: string | boolean | null,
 *   tabsScope?: string | null,
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
  tabsLayout = null,
  mouse = null,
  tabsScope = null,
} = {}) {
  if (!enabled || !session) {
    return {
      active: false, session: null, paint() {}, sync() {}, suspend() {}, resume() {}, follow() {},
      geometry() { return { cols: 80, rows: 24, panel: [], viewRows: 0, tabRowY: 0, pWidth: 0, transWidth: 80, railWidth: 0, kind: null, promptRows: PROMPT_ROWS }; },
      setPromptRows() {}, setMouse() {}, dispose() {},
      setPromptRows() {}, dispose() {},
    };
  }

  // Gated: with the setting off, nothing is written, so the terminal keeps its own text selection.
  let mouseEnabled = isMouseEnabled(mouse, session);
  if (mouseEnabled) enableMouse(output);
  const onTeardown = () => { disableMouse(output); };
  const detach = (target, event, listener) => {
    if (typeof target?.off === "function") target.off(event, listener);
    else target?.removeListener?.(event, listener);
  };
  ["exit", "SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => process.on?.(sig, onTeardown));

  const viewport = createViewport({ rows: output.rows || 24 });
  const compaction = createCompactionWatcher(session);
  let painted = [];
  let promptReservation = PROMPT_ROWS;

  const setPromptRows = (rows) => {
    // Clamps reservation without repainting immediately; repainting while composer
    // is drawing its draft/menu would erase them before input is completed.
    const termRows = Math.max(6, Number(output.rows) || 24);
    const clamped = clampPromptRows(rows, termRows);
    if (clamped !== promptReservation) promptReservation = clamped;
  };

  if (composer) {
    typeof composer.onRows === "function" ? composer.onRows(setPromptRows) : (composer.onRows = setPromptRows);
  }
  session.onComposerRows = setPromptRows;

  // Geometry lives in mso-agent-panel-geometry.mjs: three features touch layout and this file is at its
  // ceiling, but the arithmetic still has exactly one home.
  const geometry = (reservation = promptReservation) => panelGeometry({
    output, session, colors, getSessions, promptReservation: reservation, tabsLayout, tabsScope,
  });
  const currentSessions = () => geometry().sessions;

  // Repaints from the top of the screen and leaves the cursor where the composer expects to start,
  // because the composer paints relative to the cursor and cannot be told where to begin.
  const paint = () => {
    if (output?.isTTY !== true) return;
    const { panel, viewRows, pWidth, transWidth, railWidth, kind } = geometry();
    const body = renderViewport(viewport, { colors, width: transWidth, rows: viewRows });
    const side = pWidth > 0 ? paneLines({ kind, session, colors, width: pWidth, rows: viewRows }) : [];
    const rail = railWidth > 0 ? tabRailLines(currentSessions(), session?.agentSession?.id, { colors, width: railWidth, rows: viewRows }) : [];
    const joined = body.map((line, i) => `${rail[i] || ""}${line}${side[i] || ""}`);
    const frame = [...joined, ...panel, ""];
    output.write("\x1b[H");
    painted = writeFrame(output, painted, frame);
    output.write(`\x1b[${frame.length};1H`);
  };

  const sync = () => {
    commitStream(viewport);
    compaction.check(session, { colors });
    const trans = transcriptLines(session, { colors, width: geometry().transWidth, groupTools: session?.grouping === "auto" });
    setLines(viewport, withPreamble(preamble?.() ?? null, [...trans, ...compaction.lines(colors)]));
    paint();
  };

  // Streaming text goes into the buffer and repaints, so a long answer does not wait for the turn to
  // end before it becomes visible. Command output arrives as whole lines instead of chunks, so it is
  // committed immediately rather than left as a partial line.
  session.streamSink = { write(chunk) { appendStream(viewport, chunk); paint(); } };
  session.printSink = (line) => { appendStream(viewport, `${String(line ?? "")}\n`); commitStream(viewport); paint(); };

  const onResize = () => { viewport.rows = output.rows || 24; sync(); };
  output.on?.("resize", onResize);

  const dispatchMouse = (event) => {
    // When mouse setting is off, ignore wheel and click completely so terminal selection works.
    if (!event || !mouseEnabled) return false;
    if (event.kind === "wheel") {
      if (handleMouse(viewport, event, { rows: geometry().viewRows, step: session?.scrollSpeed })) { paint(); return true; }
      return false;
    }
    if (event.kind === "click") {
      const { cols, tabRowY, railWidth, viewRows } = geometry();
      const hitOpts = railWidth > 0
        ? { x: event.x, y: event.y, width: railWidth, rows: viewRows, orientation: "vertical" }
        : { x: event.x, y: event.y, width: cols, tabRow: tabRowY, orientation: "horizontal" };
      const targetId = tabAtPoint(currentSessions(), session?.agentSession?.id, hitOpts);
      if (targetId && typeof onTabClick === "function") {
        Promise.resolve(onTabClick(targetId)).then(paint).catch(() => {});
        return true;
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
    isMouseEnabled: () => mouseEnabled,
  });
  const { suspend, resume } = panelSuspend;

  const initLines = transcriptLines(session, { colors, width: geometry().transWidth, groupTools: session?.grouping === "auto" });
  setLines(viewport, withPreamble(preamble?.() ?? null, [...initLines, ...compaction.lines(colors)]));
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
    setMouse(val) {
      const next = isMouseEnabled(val);
      if (mouseEnabled === next) return;
      mouseEnabled = next;
      if (session) session.mouse = next ? "on" : "off";
      setMouseReporting(output, next);
    },
    dispose() {
      ["exit", "SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => detach(process, sig, onTeardown));
      output.off?.("resize", onResize);
      hook.dispose();
      disableMouse(output);
      compaction.reset();
      delete session.streamSink; delete session.printSink;
      delete session.onComposerRows; delete session.screenLoop;
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
