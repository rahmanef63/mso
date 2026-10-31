#!/usr/bin/env node
import process from "node:process";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { AgentInterruptManager } from "./mso-agent-interrupt.mjs";
import { slashCompletionItems } from "./mso-agent-slash.mjs";
import { persistSession, restartSessionArg, resumeArg, startupSession, syncPromptHistory } from "./mso-agent-session-ui.mjs";
import { C, printBanner } from "./mso-agent-runtime.mjs";
import { listCliSessions, state } from "./mso-agent-api.mjs";
import { handleSlash } from "./mso-agent-commands.mjs";
import { nextPermissionMode, permissionMode } from "./mso-agent-permissions.mjs";
import { consumeRestartUiState, relaunchCurrentAgentSession } from "./mso-agent-lifecycle.mjs";
import { oneShotHelp, parseOneShot } from "./mso-agent-oneshot.mjs";
import { LocalAgentBridge, handleLocalAgentMentionInput, runForegroundSubagent } from "./mso-agent-collaboration.mjs";
import { composerPrompt, composerSeparator } from "./mso-agent-layout.mjs";
import { executeTool, renderInteractionFailure, runInteractiveRound } from "./mso-agent-turn.mjs";
import { runOneShot } from "./mso-agent-oneshot-run.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";
import { pathToFileURL } from "node:url";
import { createQueue, dequeue } from "./mso-agent-queue.mjs";
import { pendingImageBlock } from "./mso-agent-image.mjs";
import { altScreenRequested, startAltScreen } from "./mso-agent-altscreen.mjs";
import { captureBanner } from "./mso-agent-banner-lines.mjs";
import { visibleSessionRows } from "./mso-agent-sessions.mjs";
import { chromeLines } from "./mso-agent-chrome.mjs";
import { switchToSession } from "./mso-agent-cmd-session.mjs";

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(`${oneShotHelp()}\n`); return; }
  const oneShot = parseOneShot(argv);
  if (oneShot) return runOneShot(oneShot);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("mso agent needs an interactive terminal. For autonomous one-shot use: mso agent --oneshot \"<prompt>\" [--json]");
    process.exit(2);
  }
  const altScreen = altScreenRequested({ argv, env: process.env, isTTY: process.stdout.isTTY });
  if (altScreen.requested && !altScreen.ok) {
    console.warn(`${C.dim}mso agent: alternate screen not enabled (${altScreen.reason})${C.reset}`);
  }
  // Declared out here, not inside the try: the finally block disposes them, and a `const` inside
  // the try is not in scope there. A ReferenceError in finally replaced the real exit status.
  let screenLoop = null;
  let screen = null; let session = null; let rl = null;
  let localBridge = null; let onSigint = null; let restartRequested = false;
  try {
    screen = startAltScreen({ requested: altScreen, output: process.stdout });
    const restartSessionId = restartSessionArg(argv);
    const requested = restartSessionId ? null : resumeArg(argv);
    const restartUi = consumeRestartUiState();
    const forcedPermission = argv.some((arg) => ["--yolo", "-yolo", "-y"].includes(arg))
      ? "yolo"
      : (permissionMode(restartUi.permission)?.id || "ask");
    const [s, agentSession] = await Promise.all([state(), startupSession(requested, restartSessionId)]);
    if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
    const bannerLines = altScreen.ok ? captureBanner(printBanner, s, agentSession, { keep: 4 }) : (printBanner(s, agentSession), null);
    session = {
      state: s,
      agentSession,
      history: Array.isArray(agentSession.history) ? agentSession.history : [],
      pendingSkill: null, activeSkill: null, lastInvokedSkill: null,
      titleOverride: (requested || restartSessionId) ? (agentSession.title || null) : null,
      usage: { apiCalls: 0 }, lastRouting: null, lastElapsedMs: 0,
      statusBar: restartUi.statusBar ?? true, permission: forcedPermission, pendingApproval: null,
      // Ephemeral queue: held only in memory for this TUI process and not persisted to server state.
      queue: createQueue(),
    };
    let recentSessions = session.agentSession ? [session.agentSession] : [];
    // Refreshed after a switch, not per keystroke: a tab row must not cost a network call per render.
    const refreshSessions = () => { listCliSessions(20).then((rows) => { recentSessions = visibleSessionRows(rows); }).catch(() => {}); };
    refreshSessions();
    const chromeFooter = () => chromeLines({ session, sessions: recentSessions, activeId: session?.agentSession?.id, colors: C, width: process.stdout.columns, rows: process.stdout.rows });
    screenLoop = mountScreenLoop({
      session,
      enabled: altScreen.ok,
      output: process.stdout,
      input: process.stdin,
      colors: C,
      getSessions: () => recentSessions,
      preamble: () => bannerLines,
      onTabClick: async (targetId) => {
        if (!targetId || targetId === session?.agentSession?.id) return;
        await switchToSession(rl, session, targetId);
        if (localBridge) await localBridge.syncSession();
        refreshSessions();
        screenLoop.sync();
      },
    });
    rl = new AgentComposer({ input: process.stdin, output: process.stdout, colors: C, onRows: (rows) => screenLoop.setPromptRows(rows), onToggleStatusBar: () => { session.statusBar = !session.statusBar; screenLoop.paint(); } }); syncPromptHistory(rl, session);
    let inboundRequestQueued = false;
    localBridge = new LocalAgentBridge({
      session,
      composer: rl,
      onRequest: () => {
        // A local request otherwise only becomes model context on the next manual
        // turn. Cancel the idle editor and let the main loop run it immediately.
        inboundRequestQueued = true;
        rl.cancelCurrent({ echo: false });
      },
    });
    await localBridge.start();
    const interrupts = new AgentInterruptManager({ output: process.stdout, colors: C });
    let lastTurnInterrupted = false;
    const originalBeginTurn = interrupts.beginTurn.bind(interrupts);
    interrupts.beginTurn = () => {
      const signal = originalBeginTurn();
      lastTurnInterrupted = false;
      signal.addEventListener("abort", () => {
        lastTurnInterrupted = true;
      }, { once: true });
      return signal;
    };
    const originalInterruptCurrent = interrupts.interruptCurrent.bind(interrupts);
    interrupts.interruptCurrent = () => {
      lastTurnInterrupted = true;
      return originalInterruptCurrent();
    };
    const drainQueue = async () => {
      while (!interrupts.exitRequested && !lastTurnInterrupted) {
        const nextPrompt = dequeue(session.queue);
        if (!nextPrompt) break;
        session.history.push({ role: "user", text: nextPrompt });
        const skillContext = session.pendingSkill;
        session.pendingSkill = null;
        await runInteractiveRound(rl, session, skillContext, interrupts, localBridge);
        screenLoop.sync();
      }
    };
    onSigint = () => {
      const action = interrupts.handleSigint();
      // External child TUIs can restore the shared terminal to cooked mode. In that
      // state Ctrl+C arrives as SIGINT instead of a raw keypress, so wake whichever
      // composer prompt is currently waiting instead of leaving it hung.
      if (action === "exit") rl.cancelCurrent({ echo: true });
      else if (action === "interrupt") rl.cancelCurrent({ echo: false });
    };
    process.on("SIGINT", onSigint);
    const completeSlash = (line) => slashCompletionItems(session.state.skills, line, process.cwd(), session);
    while (true) {
      if (interrupts.exitRequested) break;
      if (inboundRequestQueued) {
        inboundRequestQueued = false;
        await runInteractiveRound(rl, session, null, interrupts, localBridge);
        screenLoop.sync();
        continue;
      }
      let line = "";
      try {
        screenLoop.paint();
        const answer = await rl.question(() => composerPrompt(session, C), {
          complete: completeSlash,
          onTab: () => { session.permission = nextPermissionMode(session.permission).id; },
          // The panel already draws the separator and the footer above the prompt, so drawing
          // them twice would push the prompt off the reserved rows.
          separator: () => (screenLoop.active ? "" : composerSeparator(session, C, process.stdout.columns)),
          footer: () => (screenLoop.active ? "" : chromeFooter()),
        });
        if (answer === null) {
          if (inboundRequestQueued) continue;
          break;
        }
        line = answer.trim();
        screenLoop.follow();
      } catch { break; }
      if (!line) continue;
      if (line.startsWith("/")) {
        try {
          const result = await handleSlash(rl, line, session, { runTurn: (skill) => runInteractiveRound(rl, session, skill, interrupts, localBridge), runSubagent: (input) => runForegroundSubagent({ rl, session, input, executeTool, colors: C }) });
          if (result === "exit") break;
          if (result === "restart") { restartRequested = true; break; }
          if (result === "refresh") { await localBridge.syncSession(); refreshSessions(); }
          if (result === "drain") {
            lastTurnInterrupted = false;
            await drainQueue();
          }
          if (result === "unknown") console.log("unknown command; /help lists commands.");
        } catch (error) {
          renderInteractionFailure(error, session, {}, C);
          await persistSession(session).catch(() => undefined);
        }
        screenLoop.sync();
        if (interrupts.exitRequested) break;
        continue;
      }
      if (await handleLocalAgentMentionInput(session, line, C)) { screenLoop.sync(); continue; }
      // Attached images belong to the NEXT prompt only. Format them into the user
      // message once, then clear, so a stale image can never ride along silently.
      const images = Array.isArray(session.pendingImages) ? session.pendingImages : [];
      const imageBlock = images.length ? pendingImageBlock(images) : "";
      session.history.push({ role: "user", text: imageBlock ? `${imageBlock}${line}` : line });
      if (images.length) session.pendingImages = [];
      const skillContext = session.pendingSkill;
      session.pendingSkill = null;
      screenLoop.sync();
      await runInteractiveRound(rl, session, skillContext, interrupts, localBridge);
      screenLoop.sync();
      if (interrupts.exitRequested) break;
      if (!lastTurnInterrupted) await drainQueue();
    }
  } finally {
    if (onSigint) process.off("SIGINT", onSigint);
    if (session) await persistSession(session).catch(() => undefined);
    const sessionTitle = String(session?.agentSession?.title || "MSO Agent session").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
    if (!restartRequested && session) console.log(`${C.dim}session ${sessionTitle} · resume: mso --continue · switch: /sessions${C.reset}`);
    if (localBridge) await localBridge.close({ ended: !restartRequested }).catch(() => undefined);
    rl?.close();
    screenLoop?.dispose();
    screen?.dispose();
  }
  if (restartRequested) {
    console.log(`${C.dim}↻ refreshing Agent runtime · keeping ${session.agentSession.title || "current session"}${C.reset}`);
    relaunchCurrentAgentSession(session);
  }
}

const direct = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main().catch((error) => { console.error(`${C.err}mso agent: ${error instanceof Error ? error.message : String(error)}${C.reset}`); process.exit(1); });
