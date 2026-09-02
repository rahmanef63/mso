#!/usr/bin/env node
import process from "node:process";
import { canonicalAgentApproval } from "../lib/agent/approval.mjs";
import { beginSkillInvocation, endSkillInvocation } from "./mso-agent-skills.mjs";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { AgentInterruptManager, isAbortError } from "./mso-agent-interrupt.mjs";
import { slashCompletionItems } from "./mso-agent-slash.mjs";
import { addUsage, renderStatusBar } from "./mso-agent-status.mjs";
import { persistSession, resumeArg, startupSession, syncPromptHistory } from "./mso-agent-session-ui.mjs";
import { C, api, printBanner, state, streamTurn } from "./mso-agent-runtime.mjs";
import { handleSlash } from "./mso-agent-commands.mjs";
import { approvesTool, nextPermissionMode, permissionMode, permissionPrompt } from "./mso-agent-permissions.mjs";
import { consumeRestartUiState, relaunchCurrentAgentSession } from "./mso-agent-lifecycle.mjs";
import { oneShotApproves, oneShotHelp, parseOneShot } from "./mso-agent-oneshot.mjs";

async function executeTool(rl, tool, call, agentSession, permission = "ask", signal = undefined, onInterrupt = null, options = {}) {
  if (!tool) return { ok: false, result: `unknown tool requested by model: ${call.name}` };
  const needsApprovalDigest = tool.scope !== "read";
  let approval = null;
  if (needsApprovalDigest) {
    try { approval = canonicalAgentApproval(tool.name, call.input || {}); }
    catch (error) { return { ok: false, result: `cannot safely approve tool call: ${error instanceof Error ? error.message : String(error)}` }; }
  }
  let approved = options.approvalScope
    ? oneShotApproves(options.approvalScope, tool.scope)
    : approvesTool(permission, tool.scope);
  if (!approved) {
    // Autonomous one-shot mode must never fall back to an interactive prompt.
    // Its default approval scope is read, so write/exec fail closed unless the
    // caller explicitly chose --approve-scope write|exec.
    if (options.approvalScope) return { ok: false, result: "denied by user" };
    console.log(`${C.warn}${C.bold}[${tool.scope.toUpperCase()}] exact tool call${C.reset}`);
    console.log(approval.display);
    console.log(`${C.dim}sha256 ${approval.digest} · ${approval.bytes} bytes${C.reset}`);
    const answer = String(await rl.question("  allow this exact call? [y/N]: ", { history: false, onCancel: onInterrupt }) ?? "").trim().toLowerCase();
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("turn interrupted");
    if (answer === "y" || answer === "yes") approved = true;
  } else if (needsApprovalDigest && !options.quiet && !options.approvalScope) {
    const mode = permission === "yolo" ? "YOLO" : "AUTO-WRITE";
    console.log(`${C.c}${C.bold}[${tool.scope.toUpperCase()} · ${mode}]${C.reset} ${tool.name}`);
  }
  if (!approved) return { ok: false, result: "denied by user" };
  if (!options.quiet) process.stdout.write(`${C.dim}  ↳ ${tool.name}…${C.reset}`);
  try {
    const input = approval ? approval.payload.input : (call.input || {});
    const out = await api("/api/v1/agent-tools", {
      method: "POST",
      body: JSON.stringify({
        name: tool.name,
        input,
        sessionId: agentSession.id,
        ...(tool.scope === "read" ? {} : { approved: true, approvalDigest: approval.digest }),
      }),
      signal,
    });
    if (!options.quiet) process.stdout.write(`\r${C.c}  ✓ ${tool.name}${C.reset}\n`);
    if (!out.ok) return { ok: false, result: out.result || "tool failed" };
    return { ok: true, result: String(out.result ?? "ok") };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    if (!options.quiet) process.stdout.write(`\r${C.err}  ✗ ${tool.name}${C.reset}\n`);
    return { ok: false, result: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
  }
}

async function agentRound(rl, session, skillContext = null, signal = undefined, onInterrupt = null, options = {}) {
  const startedAt = Date.now();
  const historyCheckpoint = Math.max(0, session.history.length - 1);
  const calls = [];
  let finalText = "", rounds = 0;
  beginSkillInvocation(session, skillContext, C);
  try {
    for (let turn = 0; turn < 10; turn++) {
      rounds = turn + 1;
      const result = await streamTurn(session.history, session.state.tools, session.agentSession, skillContext, signal, session.state.modelMeta?.context, options.quiet ? null : process.stdout); if (skillContext) session.lastInvokedSkill = skillContext;
      finalText = result.text;
      session.usage = addUsage(session.usage, result.usage);
      session.lastElapsedMs = Date.now() - startedAt;
      session.history.push({ role: "assistant", text: result.text, toolUses: result.toolUses });
      if (!result.toolUses.length) return { text: finalText, calls, rounds, usage: session.usage, elapsedMs: session.lastElapsedMs };
      const results = [];
      for (const call of result.toolUses) {
        const tool = session.state.tools.find((row) => row.name === call.name);
        const outcome = await executeTool(rl, tool, call, session.agentSession, session.permission, signal, onInterrupt, options);
        calls.push({ name: call.name, ok: outcome.ok });
        results.push({ id: call.id, content: outcome.result, isError: !outcome.ok });
      }
      session.history.push({ role: "tool", results });
    }
    if (!options.quiet) console.log(`${C.warn}turn limit reached; ask to continue if needed.${C.reset}`);
    return { text: finalText, calls, rounds, usage: session.usage, elapsedMs: session.lastElapsedMs, turnLimitReached: true };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) session.history.splice(historyCheckpoint);
    throw error;
  } finally {
    endSkillInvocation(session, skillContext);
  }
}

async function runInteractiveRound(rl, session, skillContext, interrupts) {
  const signal = interrupts.beginTurn();
  try {
    await agentRound(rl, session, skillContext, signal, () => interrupts.interruptCurrent());
    await persistSession(session);
  } catch (error) {
    if (signal.aborted || isAbortError(error)) console.log(`${C.dim}turn interrupted.${C.reset}`);
    else console.error(`${C.err}agent error: ${error instanceof Error ? error.message : String(error)}${C.reset}`);
    await persistSession(session).catch(() => undefined);
  } finally {
    interrupts.endTurn(signal);
  }
}


async function runOneShot(opts) {
  const requested = resumeArg(process.argv.slice(2));
  const [s, agentSession] = await Promise.all([state(), startupSession(requested)]);
  if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
  const session = {
    state: s, agentSession, history: Array.isArray(agentSession.history) ? agentSession.history : [],
    pendingSkill: null, activeSkill: null, lastInvokedSkill: null,
    titleOverride: requested ? (agentSession.title || null) : null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, lastElapsedMs: 0, statusBar: false,
    permission: "ask",
  };
  session.history.push({ role: "user", text: opts.prompt });
  const result = await agentRound(null, session, null, undefined, null, { quiet: true, approvalScope: opts.approvalScope });
  await persistSession(session);
  const payload = {
    ok: true, sessionId: session.agentSession.id,
    model: `${s.config?.provider || ""}/${s.config?.model || ""}`.replace(/^\//, ""),
    approvalScope: opts.approvalScope, text: result?.text || "", rounds: result?.rounds || 0,
    toolCalls: result?.calls || [], usage: result?.usage || session.usage, elapsedMs: result?.elapsedMs || session.lastElapsedMs,
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
  const requested = resumeArg(argv);
  const restartUi = consumeRestartUiState();
  const forcedPermission = argv.some((arg) => ["--yolo", "-yolo", "-y"].includes(arg))
    ? "yolo"
    : (permissionMode(restartUi.permission)?.id || "ask");
  const [s, agentSession] = await Promise.all([
    state(),
    startupSession(requested),
  ]);
  if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
  printBanner(s, agentSession);
  const session = {
    state: s,
    agentSession,
    history: Array.isArray(agentSession.history) ? agentSession.history : [],
    pendingSkill: null,
    activeSkill: null,
    lastInvokedSkill: null,
    titleOverride: requested ? (agentSession.title || null) : null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastElapsedMs: 0,
    statusBar: restartUi.statusBar ?? true,
    permission: forcedPermission,
  };
  const rl = new AgentComposer({ input: process.stdin, output: process.stdout, colors: C });
  syncPromptHistory(rl, session);
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
        console.log();
        if (session.statusBar) console.log(renderStatusBar(session, C));
        const answer = await rl.question(() => permissionPrompt(session.permission, C), {
          complete: completeSlash,
          onTab: () => { session.permission = nextPermissionMode(session.permission).id; },
        });
        if (answer === null) break;
        line = answer.trim();
      } catch { break; }
      if (!line) continue;
      if (line.startsWith("/")) {
        try {
          const result = await handleSlash(rl, line, session, { runTurn: (skill) => runInteractiveRound(rl, session, skill, interrupts) });
          if (result === "exit") break;
          if (result === "restart") { restartRequested = true; break; }
          if (result === "unknown") console.log("unknown command; /help lists commands.");
        } catch (error) {
          console.error(`${C.err}${error instanceof Error ? error.message : String(error)}${C.reset}`);
        }
        if (interrupts.exitRequested) break;
        continue;
      }
      session.history.push({ role: "user", text: line });
      const skillContext = session.pendingSkill;
      session.pendingSkill = null;
      await runInteractiveRound(rl, session, skillContext, interrupts);
      if (interrupts.exitRequested) break;
    }
  } finally {
    process.off("SIGINT", onSigint);
    await persistSession(session).catch(() => undefined);
    const sessionTitle = String(session.agentSession.title || "MSO Agent session").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
    if (!restartRequested) console.log(`${C.dim}session ${sessionTitle} · resume: mso --continue · switch: /sessions${C.reset}`);
    rl.close();
  }
  if (restartRequested) {
    console.log(`${C.dim}↻ refreshing Agent runtime · keeping ${session.agentSession.title || "current session"}${C.reset}`);
    const code = relaunchCurrentAgentSession(session);
    if (code !== 0) process.exitCode = code;
  }
}

main().catch((error) => { console.error(`${C.err}mso agent: ${error instanceof Error ? error.message : String(error)}${C.reset}`); process.exit(1); });
