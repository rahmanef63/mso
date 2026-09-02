#!/usr/bin/env node
import process from "node:process";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { AgentInterruptManager } from "./mso-agent-interrupt.mjs";
import { slashCompletionItems } from "./mso-agent-slash.mjs";
import { persistSession, restartSessionArg, resumeArg, startupSession, syncPromptHistory } from "./mso-agent-session-ui.mjs";
import { C, printBanner } from "./mso-agent-runtime.mjs";
import { state } from "./mso-agent-api.mjs";
import { handleSlash } from "./mso-agent-commands.mjs";
import { nextPermissionMode, permissionMode } from "./mso-agent-permissions.mjs";
import { consumeRestartUiState, relaunchCurrentAgentSession } from "./mso-agent-lifecycle.mjs";
import { oneShotHelp, parseOneShot } from "./mso-agent-oneshot.mjs";
import { LocalAgentBridge, handleLocalAgentMentionInput, runForegroundSubagent } from "./mso-agent-collaboration.mjs";
import { composerFooter, composerPrompt, composerSeparator } from "./mso-agent-layout.mjs";
import { agentRound, executeTool, renderInteractionFailure, runInteractiveRound } from "./mso-agent-turn.mjs";
import { pathToFileURL } from "node:url";

async function runOneShot(opts) {
  const requested = resumeArg(process.argv.slice(2));
  const [s, agentSession] = await Promise.all([state(), startupSession(requested)]);
  if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
  const session = {
    state: s, agentSession, history: Array.isArray(agentSession.history) ? agentSession.history : [],
    pendingSkill: null, activeSkill: null, lastInvokedSkill: null,
    titleOverride: requested ? (agentSession.title || null) : null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, lastRouting: null, lastElapsedMs: 0, statusBar: false,
    permission: "ask", pendingApproval: null,
  };
  session.history.push({ role: "user", text: opts.prompt });
  const result = await agentRound(null, session, null, undefined, null, { quiet: true, approvalScope: opts.approvalScope });
  await persistSession(session);
  const payload = {
    ok: true, sessionId: session.agentSession.id,
    model: `${s.config?.provider || ""}/${s.config?.model || ""}`.replace(/^\//, ""),
    approvalScope: opts.approvalScope, text: result?.text || "", rounds: result?.rounds || 0,
    toolCalls: result?.calls || [], usage: result?.usage || session.usage, routing: session.lastRouting, elapsedMs: result?.elapsedMs || session.lastElapsedMs,
    ...(result?.turnLimitReached ? { turnLimitReached: true } : {}),
  };
  if (opts.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else process.stdout.write(`${payload.text}${payload.text.endsWith("\n") || !payload.text ? "" : "\n"}`);
}


async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(`${oneShotHelp()}\n`); return; }
  const oneShot = parseOneShot(argv);
  if (oneShot) return runOneShot(oneShot);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("mso agent needs an interactive terminal. For autonomous one-shot use: mso agent --oneshot \"<prompt>\" [--json]");
    process.exit(2);
  }
  const restartSessionId = restartSessionArg(argv);
  const requested = restartSessionId ? null : resumeArg(argv);
  const restartUi = consumeRestartUiState();
  const forcedPermission = argv.some((arg) => ["--yolo", "-yolo", "-y"].includes(arg))
    ? "yolo"
    : (permissionMode(restartUi.permission)?.id || "ask");
  const [s, agentSession] = await Promise.all([state(), startupSession(requested, restartSessionId)]);
  if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
  printBanner(s, agentSession);
  const session = {
    state: s,
    agentSession,
    history: Array.isArray(agentSession.history) ? agentSession.history : [],
    pendingSkill: null, activeSkill: null, lastInvokedSkill: null,
    titleOverride: (requested || restartSessionId) ? (agentSession.title || null) : null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, lastRouting: null, lastElapsedMs: 0,
    statusBar: restartUi.statusBar ?? true, permission: forcedPermission, pendingApproval: null,
  };
  const rl = new AgentComposer({ input: process.stdin, output: process.stdout, colors: C }); syncPromptHistory(rl, session);
  const localBridge = new LocalAgentBridge({ session, composer: rl });
  await localBridge.start();
  const interrupts = new AgentInterruptManager({ output: process.stdout, colors: C });
  const onSigint = () => {
    const action = interrupts.handleSigint();
    // External child TUIs can restore the shared terminal to cooked mode. In that
    // state Ctrl+C arrives as SIGINT instead of a raw keypress, so wake whichever
    // composer prompt is currently waiting instead of leaving it hung.
    if (action === "exit") rl.cancelCurrent({ echo: true });
    else if (action === "interrupt") rl.cancelCurrent({ echo: false });
  };
  process.on("SIGINT", onSigint);
  const completeSlash = (line) => slashCompletionItems(session.state.skills, line, process.cwd(), session);
  let restartRequested = false;
  try {
    while (true) {
      if (interrupts.exitRequested) break;
      let line = "";
      try {
        const answer = await rl.question(() => composerPrompt(session, C), {
          complete: completeSlash,
          onTab: () => { session.permission = nextPermissionMode(session.permission).id; },
          separator: () => composerSeparator(session, C, process.stdout.columns),
          footer: () => composerFooter(session, C, process.stdout.columns),
        });
        if (answer === null) break;
        line = answer.trim();
      } catch { break; }
      if (!line) continue;
      if (line.startsWith("/")) {
        try {
          const result = await handleSlash(rl, line, session, { runTurn: (skill) => runInteractiveRound(rl, session, skill, interrupts, localBridge), runSubagent: (input) => runForegroundSubagent({ rl, session, input, executeTool, colors: C }) });
          if (result === "exit") break;
          if (result === "restart") { restartRequested = true; break; }
          if (result === "refresh") await localBridge.syncSession();
          if (result === "unknown") console.log("unknown command; /help lists commands.");
        } catch (error) {
          renderInteractionFailure(error, session, {}, C);
          await persistSession(session).catch(() => undefined);
        }
        if (interrupts.exitRequested) break;
        continue;
      }
      if (await handleLocalAgentMentionInput(session, line, C)) continue;
      session.history.push({ role: "user", text: line });
      const skillContext = session.pendingSkill;
      session.pendingSkill = null;
      await runInteractiveRound(rl, session, skillContext, interrupts, localBridge);
      if (interrupts.exitRequested) break;
    }
  } finally {
    process.off("SIGINT", onSigint);
    await persistSession(session).catch(() => undefined);
    const sessionTitle = String(session.agentSession.title || "MSO Agent session").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
    if (!restartRequested) console.log(`${C.dim}session ${sessionTitle} · resume: mso --continue · switch: /sessions${C.reset}`);
    await localBridge.close({ ended: !restartRequested }).catch(() => undefined);
    rl.close();
  }
  if (restartRequested) {
    console.log(`${C.dim}↻ refreshing Agent runtime · keeping ${session.agentSession.title || "current session"}${C.reset}`);
    relaunchCurrentAgentSession(session);
  }
}

const direct = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main().catch((error) => { console.error(`${C.err}mso agent: ${error instanceof Error ? error.message : String(error)}${C.reset}`); process.exit(1); });
