#!/usr/bin/env node
import process from "node:process";
import { canonicalAgentApproval } from "../lib/agent/approval.mjs";
import { beginSkillInvocation, endSkillInvocation } from "./mso-agent-skills.mjs";
import { AgentComposer } from "./mso-agent-composer.mjs";
import { AgentInterruptManager, isAbortError } from "./mso-agent-interrupt.mjs";
import { slashCompletionItems } from "./mso-agent-slash.mjs";
import { addUsage, renderStatusBar } from "./mso-agent-status.mjs";
import { persistSession, resumeArg, startupSession } from "./mso-agent-session-ui.mjs";
import { C, api, printBanner, state, streamTurn } from "./mso-agent-runtime.mjs";
import { handleSlash } from "./mso-agent-commands.mjs";

async function executeTool(rl, tool, call, agentSession, signal = undefined, onInterrupt = null) {
  if (!tool) return { ok: false, result: `unknown tool requested by model: ${call.name}` };
  let approved = tool.scope === "read";
  let approval = null;
  if (!approved) {
    try {
      approval = canonicalAgentApproval(tool.name, call.input || {});
    } catch (error) {
      return { ok: false, result: `cannot safely approve tool call: ${error instanceof Error ? error.message : String(error)}` };
    }
    console.log(`${C.warn}${C.bold}[${tool.scope.toUpperCase()}] exact tool call${C.reset}`);
    console.log(approval.display);
    console.log(`${C.dim}sha256 ${approval.digest} · ${approval.bytes} bytes${C.reset}`);
    const answer = String(await rl.question("  allow this exact call? [y/N]: ", { history: false, onCancel: onInterrupt }) ?? "").trim().toLowerCase();
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("turn interrupted");
    if (answer === "y" || answer === "yes") approved = true;
  }
  if (!approved) return { ok: false, result: "denied by user" };
  process.stdout.write(`${C.dim}  ↳ ${tool.name}…${C.reset}`);
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
    process.stdout.write(`\r${C.c}  ✓ ${tool.name}${C.reset}\n`);
    if (!out.ok) return { ok: false, result: out.result || "tool failed" };
    return { ok: true, result: String(out.result ?? "ok") };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    process.stdout.write(`\r${C.err}  ✗ ${tool.name}${C.reset}\n`);
    return { ok: false, result: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
  }
}

async function agentRound(rl, session, skillContext = null, signal = undefined, onInterrupt = null) {
  const startedAt = Date.now();
  const historyCheckpoint = Math.max(0, session.history.length - 1);
  beginSkillInvocation(session, skillContext, C);
  try {
    for (let turn = 0; turn < 10; turn++) {
      const result = await streamTurn(session.history, session.state.tools, session.agentSession, skillContext, signal); if (skillContext) session.lastInvokedSkill = skillContext;
      session.usage = addUsage(session.usage, result.usage);
      session.lastElapsedMs = Date.now() - startedAt;
      session.history.push({ role: "assistant", text: result.text, toolUses: result.toolUses });
      if (!result.toolUses.length) return;
      const results = [];
      for (const call of result.toolUses) {
        const tool = session.state.tools.find((row) => row.name === call.name);
        const outcome = await executeTool(rl, tool, call, session.agentSession, signal, onInterrupt);
        results.push({ id: call.id, content: outcome.result, isError: !outcome.ok });
      }
      session.history.push({ role: "tool", results });
    }
    console.log(`${C.warn}turn limit reached; ask to continue if needed.${C.reset}`);
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


async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("mso agent needs an interactive terminal. For one-shot automation use: mso ai <prompt>");
    process.exit(2);
  }
  const requested = resumeArg(process.argv.slice(2));
  const [s, agentSession] = await Promise.all([
    state(),
    startupSession(requested),
  ]);
  if (!agentSession || agentSession.source !== "cli") throw new Error("could not establish a CLI MSO Agent session");
  printBanner(s, agentSession);
  const session = {
    state: s,
    agentSession,
    history: Array.isArray(agentSession.history) ? agentSession.history.slice(-48) : [],
    pendingSkill: null,
    activeSkill: null,
    lastInvokedSkill: null,
    titleOverride: requested ? (agentSession.title || null) : null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastElapsedMs: 0,
    statusBar: true,
  };
  const rl = new AgentComposer({ input: process.stdin, output: process.stdout, colors: C });
  const interrupts = new AgentInterruptManager({ output: process.stdout, colors: C });
  const onSigint = () => interrupts.handleSigint();
  process.on("SIGINT", onSigint);
  const completeSlash = (line) => slashCompletionItems(session.state.skills, line, process.cwd(), session);
  try {
    while (true) {
      if (interrupts.exitRequested) break;
      let line = "";
      try {
        console.log();
        if (session.statusBar) console.log(renderStatusBar(session, C));
        const answer = await rl.question(`${C.blue}${C.bold}›${C.reset} `, { complete: completeSlash });
        if (answer === null) break;
        line = answer.trim();
      } catch { break; }
      if (!line) continue;
      if (line.startsWith("/")) {
        try {
          const result = await handleSlash(rl, line, session, { runTurn: (skill) => runInteractiveRound(rl, session, skill, interrupts) });
          if (result === "exit") break;
          if (result === "unknown") console.log("unknown command; /help lists commands.");
        } catch (error) {
          console.error(`${C.err}${error instanceof Error ? error.message : String(error)}${C.reset}`);
        }
        if (interrupts.exitRequested) break;
        continue;
      }
      session.history.push({ role: "user", text: line });
      if (session.history.length > 48) session.history.splice(0, session.history.length - 48);
      const skillContext = session.pendingSkill;
      session.pendingSkill = null;
      await runInteractiveRound(rl, session, skillContext, interrupts);
      if (interrupts.exitRequested) break;
    }
  } finally {
    process.off("SIGINT", onSigint);
    await persistSession(session).catch(() => undefined);
    console.log(`${C.dim}session ${session.agentSession.id} · resume: mso --continue  |  mso --resume ${session.agentSession.id}${C.reset}`);
    rl.close();
  }
}

main().catch((error) => { console.error(`${C.err}mso agent: ${error instanceof Error ? error.message : String(error)}${C.reset}`); process.exit(1); });
