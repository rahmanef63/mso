#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { api } from "./mso-agent-api.mjs";
import {
  EVENT_KINDS, callTool, clean, csv, evidenceInput, fail, findString, freshRunId,
  listRuns, output, parseArgs, resolveState, saveState, validRunId
} from "./a2a-trace-support.mjs";

function usage() {
  return [
    "A2A workflow trace bridge", "", "Usage:",
    "  mso a2a trace start --intent <text> [--project <project>] [--agent <name>] [--constraints <text>]",
    "                      [--affected a,b] [--reserved a,b] [--run <id>]",
    "  mso a2a trace progress|plan|action|evidence|blocker|result|handoff --run <id> --message <text> [--stage <name>]",
    "  mso a2a trace status --run <id>",
    "  mso a2a trace context --run <id> [--limit 120]",
    "  mso a2a trace attach --session <id> --workflow <id> [--agent <name>] [--project <project>] [--run <id>]",
    "  mso a2a trace finish --run <id> --summary <text> [--failed] [--evidence <JSON|@file|->]",
    "  mso a2a trace cancel --run <id> [--reason <text>]", "  mso a2a trace list", "",
    "Trace events are observable progress only. Never send secrets, system prompts, hidden reasoning, or private chain-of-thought."
  ].join("\n");
}

async function start(options) {
  const intent = clean(options.intent || options._[0], 1000);
  if (!intent) fail("start requires --intent <text>");
  const agent = clean(options.agent || process.env.MSO_A2A_AGENT || "external", 48) || "external";
  const project = clean(options.project || "", 240) || undefined;
  const constraints = clean(options.constraints || "", 500) || undefined;
  const runId = validRunId(options.run);
  const sessionOut = await api("/api/v1/agent-sessions", {
    method: "POST",
    body: JSON.stringify({ action: "create", title: "A2A " + agent + ": " + intent.slice(0, 88), cwd: process.cwd() })
  });
  const session = sessionOut && sessionOut.session;
  if (!session || !session.id) fail("MSO did not create a durable agent session");
  const affected = csv(options.affected), reserved = csv(options.reserved);
  const workflow = await callTool(session.id, "workflow_start", {
    intent, ...(project ? { project } : {}), ...(constraints ? { constraints } : {}),
    ...(affected ? { affected_paths: affected } : {}), ...(reserved ? { reserved_resources: reserved } : {})
  }, "write");
  const workflowId = clean(
    (workflow && (workflow.workflowId || (workflow.workflow && workflow.workflow.id) || workflow.id)) || "", 120
  );
  if (!workflowId) fail("MSO workflow_start did not return a workflow id");
  const now = new Date().toISOString();
  const state = {
    version: 1, runId, agent, ...(project ? { project } : {}), sessionId: session.id,
    ...(session.label || session.name ? { sessionLabel: session.label || session.name } : {}),
    workflowId, status: "active", startedAt: now, updatedAt: now
  };
  await saveState(state);
  output({
    ok: true, run_id: runId, agent, session_id: session.id, session_label: state.sessionLabel,
    workflow_id: workflowId, workspace: findString(workflow, "workspacePath"),
    instruction: "Use this exact run for progress events. If MSO returned an isolated workspace, perform source-changing work there. Finish only with verification evidence."
  });
}

async function attach(options) {
  if (!options.session || !options.workflow) fail("attach requires --session <id> and --workflow <id>");
  const state = await resolveState({
    ...options, run: undefined, "run-id": options.run || freshRunId()
  });
  state.runId = validRunId(options.run || state.runId);
  state.status = "active";
  state.updatedAt = new Date().toISOString();
  const status = await callTool(state.sessionId, "workflow_status", { workflow_id: state.workflowId }, "read");
  await saveState(state);
  output({ ok: true, run_id: state.runId, session_id: state.sessionId, workflow_id: state.workflowId, status });
}

async function emit(kind, options) {
  const state = await resolveState(options);
  const message = clean(options.message || options._[0], 360);
  if (!message) fail(kind + " requires --message <text>");
  const stage = clean(options.stage || "", 40);
  const note = clean("[A2A:" + (state.agent || "external") + "] " + kind + (stage ? "/" + stage : "") + " - " + message, 490);
  const fingerprint = kind + "|" + stage + "|" + message, nowMs = Date.now();
  if (state.lastFingerprint === fingerprint && nowMs - Number(state.lastEventMs || 0) < 15000) {
    output({ ok: true, deduplicated: true, run_id: state.runId, workflow_id: state.workflowId });
    return;
  }
  await callTool(state.sessionId, "agent_session_note", { note, workflow_id: state.workflowId }, "write");
  if (options.run) {
    state.updatedAt = new Date(nowMs).toISOString();
    state.lastEventMs = nowMs;
    state.lastFingerprint = fingerprint;
    await saveState(state);
  }
  output({ ok: true, run_id: state.runId, workflow_id: state.workflowId, event: { kind, ...(stage ? { stage } : {}), message } });
}

async function status(options) {
  const state = await resolveState(options);
  const workflow = await callTool(state.sessionId, "workflow_status", { workflow_id: state.workflowId }, "read");
  output({ ok: true, run_id: state.runId, session_id: state.sessionId, workflow_id: state.workflowId, workflow });
}

async function context(options) {
  const state = await resolveState(options);
  const limit = Math.max(1, Math.min(120, Number(options.limit) || 120));
  const flow = await callTool(state.sessionId, "agent_session_flow", { session_ref: state.sessionId, limit }, "read");
  output({ ok: true, run_id: state.runId, workflow_id: state.workflowId, flow });
}

async function finish(options) {
  const state = await resolveState(options);
  const summary = clean(options.summary || options._[0], 1200);
  if (!summary) fail("finish requires --summary <text>");
  const success = options.failed !== true && options.success !== "false";
  const evidence = await evidenceInput(options.evidence);
  const result = await callTool(state.sessionId, "workflow_finish", {
    workflow_id: state.workflowId, summary, success, ...(evidence ? { evidence } : {})
  }, "write");
  if (options.run) {
    state.status = success ? "finished" : "failed";
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }
  output({ ok: true, run_id: state.runId, workflow_id: state.workflowId, success, result });
}

async function cancel(options) {
  const state = await resolveState(options);
  const reason = clean(options.reason || options._[0], 500);
  const result = await callTool(state.sessionId, "workflow_cancel", {
    workflow_id: state.workflowId, ...(reason ? { reason } : {})
  }, "write");
  if (options.run) {
    state.status = "cancelled";
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }
  output({ ok: true, run_id: state.runId, workflow_id: state.workflowId, result });
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === "help" || command === "--help" || command === "-h") { process.stdout.write(usage() + "\n"); return; }
  if (command === "start") return start(options);
  if (command === "attach") return attach(options);
  if (EVENT_KINDS.has(command)) return emit(command, options);
  if (command === "status") return status(options);
  if (command === "context") return context(options);
  if (command === "finish") return finish(options);
  if (command === "cancel") return cancel(options);
  if (command === "list") return listRuns();
  fail("unknown A2A trace command: " + command + "\n" + usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write("a2a-trace: " + (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
