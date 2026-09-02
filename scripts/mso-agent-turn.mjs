import process from "node:process";
import { canonicalAgentApproval } from "../lib/agent/approval.mjs";
import { requestExactToolApproval } from "./mso-agent-approval-ui.mjs";
import { AgentMutationUncertainError, isAgentApiError, isRecoverableInteractionError, recoverableErrorLines, recoverableHistoryRow, recoverableTurnState } from "./mso-agent-errors.mjs";
import { printSection, sectionDivider } from "./mso-agent-layout.mjs";
import { beginSkillInvocation, endSkillInvocation } from "./mso-agent-skills.mjs";
import { isAbortError } from "./mso-agent-interrupt.mjs";
import { approvesTool } from "./mso-agent-permissions.mjs";
import { api, C, streamTurn } from "./mso-agent-runtime.mjs";
import { persistSession } from "./mso-agent-session-ui.mjs";
import { addUsage } from "./mso-agent-status.mjs";
import { oneShotApproves } from "./mso-agent-oneshot.mjs";

function lazyAssistantOutput(session, options = {}) {
  if (options.quiet) return null;
  let opened = false;
  return {
    write(value) {
      if (!opened) {
        opened = true;
        printSection("assistant", { detail: `@${session?.agentSession?.name || "agent"}`, colors: C });
      }
      return process.stdout.write(String(value ?? ""));
    },
  };
}

export async function executeTool(rl, tool, call, agentSession, permission = "ask", signal = undefined, onInterrupt = null, options = {}) {
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
    if (options.approvalScope) return { ok: false, result: "denied by user" };
    const approvalState = options.approvalState || null;
    if (approvalState) approvalState.pendingApproval = {
      tool: tool.name, scope: tool.scope, digest: approval?.digest || null, createdAt: new Date().toISOString(),
    };
    try {
      approved = await requestExactToolApproval(rl, {
        tool, input: call.input || {}, approval, onCancel: onInterrupt, signal, colors: C,
      });
      if (approvalState) approvalState.pendingApproval = null;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) { if (approvalState) approvalState.pendingApproval = null; }
      throw error;
    }
  } else if (needsApprovalDigest && !options.quiet && !options.approvalScope) {
    console.log(`${C.c}${C.bold}[${tool.scope}]${C.reset} ${tool.name}`);
  }
  if (!approved) return { ok: false, result: "denied by user" };
  if (!options.quiet) process.stdout.write(`${C.dim}  ↳ ${tool.name}…${C.reset}`);
  const request = options.apiRequest || api;
  try {
    const input = approval ? approval.payload.input : (call.input || {});
    const out = await request("/api/v1/agent-tools", {
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
    if (tool.scope !== "read" && isAgentApiError(error)) throw new AgentMutationUncertainError(tool.name, error);
    return { ok: false, result: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
  }
}

export async function agentRound(rl, session, skillContext = null, signal = undefined, onInterrupt = null, options = {}) {
  const startedAt = Date.now();
  const historyCheckpoint = Math.max(0, session.history.length - 1);
  const calls = [];
  let finalText = "", rounds = 0;
  beginSkillInvocation(session, skillContext, C);
  const turnStream = options.streamTurn || streamTurn;
  const toolExecutor = options.executeTool || executeTool;
  try {
    for (let turn = 0; turn < 10; turn++) {
      rounds = turn + 1;
      const result = await turnStream(
        session.history, session.state.tools, session.agentSession, skillContext, signal,
        session.state.modelMeta?.context, lazyAssistantOutput(session, options),
      );
      if (skillContext) session.lastInvokedSkill = skillContext;
      finalText = result.text;
      session.usage = addUsage(session.usage, result.usage);
      session.lastRouting = result.routing || null;
      session.lastElapsedMs = Date.now() - startedAt;
      session.history.push({ role: "assistant", text: result.text, toolUses: result.toolUses });
      if (!result.toolUses.length) return { text: finalText, calls, rounds, usage: session.usage, elapsedMs: session.lastElapsedMs };
      if (!options.quiet) printSection("work", { detail: `@${session?.agentSession?.name || "agent"}`, colors: C });
      const results = [];
      for (const call of result.toolUses) {
        const tool = session.state.tools.find((row) => row.name === call.name);
        const outcome = await toolExecutor(rl, tool, call, session.agentSession, session.permission, signal, onInterrupt, {
          ...options, approvalState: options.approvalState || session,
        });
        calls.push({ name: call.name, scope: tool?.scope || "unknown", ok: outcome.ok });
        results.push({ id: call.id, content: outcome.result, isError: !outcome.ok });
      }
      session.history.push({ role: "tool", results });
    }
    if (!options.quiet) console.log(`${C.warn}turn limit reached; ask to continue if needed.${C.reset}`);
    return { text: finalText, calls, rounds, usage: session.usage, elapsedMs: session.lastElapsedMs, turnLimitReached: true };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) session.history.splice(historyCheckpoint);
    else if (error && typeof error === "object" && !error.turnJournal) error.turnJournal = { calls: [...calls] };
    throw error;
  } finally {
    endSkillInvocation(session, skillContext);
  }
}

export function renderInteractionFailure(error, session, journal = {}, colors = C, print = console.log) {
  const state = recoverableTurnState(error, journal);
  print(sectionDivider("error", { detail: `@${session?.agentSession?.name || "agent"}`, colors }));
  for (const line of recoverableErrorLines(state)) print(`${colors.err || ""}${line}${colors.reset || ""}`);
  return state;
}

export async function runInteractiveRound(rl, session, skillContext, interrupts, localBridge = null) {
  const signal = interrupts.beginTurn();
  await localBridge?.setState("busy");
  let roundResult = null;
  try {
    roundResult = await agentRound(rl, session, skillContext, signal, () => interrupts.interruptCurrent());
    await persistSession(session);
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      console.log(`${C.dim}turn interrupted.${C.reset}`);
    } else {
      const journal = error?.turnJournal || { calls: roundResult?.calls || [] };
      const state = renderInteractionFailure(error, session, journal, C);
      if (isRecoverableInteractionError(error)) session.history.push(recoverableHistoryRow(state));
    }
    await persistSession(session).catch(() => undefined);
  } finally {
    interrupts.endTurn(signal);
    await localBridge?.setState("idle");
  }
}
