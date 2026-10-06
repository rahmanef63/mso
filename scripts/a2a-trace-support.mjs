import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { canonicalAgentApproval } from "../lib/agent/approval.mjs";
import { api } from "./mso-agent-api.mjs";

export const EVENT_KINDS = new Set(["plan", "progress", "action", "evidence", "blocker", "result", "handoff"]);
const RUN_RE = /^[a-z0-9][a-z0-9-]{5,80}$/;
const ROOT = process.env.MSO_A2A_TRACE_STATE_DIR || path.join(os.homedir(), ".mso", "private", "a2a-traces");

export function fail(message) {
  const error = new Error(message);
  error.code = "A2A_TRACE";
  throw error;
}

export function clean(value, max) {
  const out = String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return max ? out.slice(0, max) : out;
}

export function parseArgs(argv) {
  const command = argv[0] || "help";
  const options = { _: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) { options._.push(value); continue; }
    const eq = value.indexOf("=");
    if (eq > 2) { options[value.slice(2, eq)] = value.slice(eq + 1); continue; }
    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else { options[key] = next; i += 1; }
  }
  return { command, options };
}

export function csv(value) {
  if (!value) return undefined;
  const rows = String(value).split(",").map((row) => row.trim()).filter(Boolean).slice(0, 80);
  return rows.length ? rows : undefined;
}

export function validRunId(value) {
  const id = clean(value || ("a2a-" + randomUUID().slice(0, 12)), 80).toLowerCase();
  if (!RUN_RE.test(id)) fail("run id must be 6-80 lowercase letters, digits, or hyphens");
  return id;
}

export function freshRunId() {
  return "a2a-" + randomUUID().slice(0, 12);
}

async function ensureStateRoot() {
  await fs.mkdir(ROOT, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(ROOT);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("unsafe A2A trace state directory");
  await fs.chmod(ROOT, 0o700).catch(() => undefined);
}

async function statePath(id) {
  await ensureStateRoot();
  return path.join(ROOT, validRunId(id) + ".json");
}

const STATE_LIMITS = { runId: 80, agent: 48, project: 240, sessionId: 120, sessionLabel: 120, workflowId: 120, status: 24, startedAt: 40, updatedAt: 40, lastFingerprint: 600 };
function stateIdentifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) fail("invalid A2A trace identifiers");
  return value;
}
function checkState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) fail("invalid A2A trace state");
  const fields = Object.getOwnPropertyDescriptors(state);
  if (Object.values(fields).some((field) => !Object.hasOwn(field, "value"))) fail("invalid A2A trace accessor");
  const runId = fields.runId?.value, status = fields.status?.value;
  if (fields.version?.value !== 1 || typeof runId !== "string" || runId !== validRunId(runId)) fail("invalid A2A trace state");
  if (!["active", "attached", "finished", "failed", "cancelled"].includes(status)) fail("invalid A2A trace status");
  const snapshot = {
    version: 1, runId, status,
    sessionId: stateIdentifier(fields.sessionId?.value),
    workflowId: stateIdentifier(fields.workflowId?.value),
  };
  for (const [key, field] of Object.entries(fields)) {
    if (Object.hasOwn(snapshot, key)) continue;
    const value = field.value;
    if (key === "lastEventMs") {
      if (!Number.isSafeInteger(value) || value < 0) fail("invalid A2A trace timestamp");
    } else if (!Object.hasOwn(STATE_LIMITS, key) || (value !== undefined && (typeof value !== "string" || value.length > STATE_LIMITS[key]))) fail("invalid A2A trace field: " + key);
    snapshot[key] = value;
  }
  return snapshot;
}

export async function saveState(state) {
  const snapshot = checkState(state);
  const body = JSON.stringify(snapshot, null, 2) + "\n";
  if (Buffer.byteLength(body, "utf8") > 8192) fail("invalid A2A trace state size");
  const file = await statePath(snapshot.runId);
  const temp = file + "." + process.pid + "." + Date.now() + ".tmp";
  await fs.writeFile(temp, body, { mode: 0o600, flag: "wx" });
  await fs.rename(temp, file);
}

export async function readState(id) {
  const file = await statePath(id);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192) fail("invalid A2A trace state file");
    const body = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(body, 0, body.length, 0);
    if (bytesRead !== body.length) fail("A2A trace state changed during read");
    return checkState(JSON.parse(body.toString("utf8")));
  } finally { await handle.close(); }
}

export async function resolveState(options) {
  if (options.run) return readState(options.run);
  if (options.session && options.workflow) {
    return {
      version: 1, runId: validRunId(options["run-id"] || "a2a-attached"),
      agent: clean(options.agent || "external", 48), project: clean(options.project || "", 240) || undefined,
      sessionId: clean(options.session, 120), workflowId: clean(options.workflow, 120),
      status: "attached", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }
  fail("pass --run <id>, or both --session <session-id> --workflow <workflow-id>");
}

function toolResult(out) {
  if (!out || out.ok === false) fail(clean((out && (out.result || out.error)) || "MSO tool call failed", 1200));
  if (typeof out.result !== "string") return out.result;
  try { return JSON.parse(out.result); } catch { return out.result; }
}

export async function callTool(sessionId, name, input, scope) {
  const payload = { name, input, sessionId };
  if (scope !== "read") {
    const approval = canonicalAgentApproval(name, input);
    payload.input = approval.payload.input;
    payload.approved = true;
    payload.approvalDigest = approval.digest;
  }
  const out = await api("/api/v1/agent-tools", { method: "POST", body: JSON.stringify(payload) });
  return toolResult(out);
}

export function findString(value, key) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.hasOwn(value, key) && typeof value[key] === "string") return value[key];
  for (const nested of Object.values(value)) {
    const found = findString(nested, key);
    if (found) return found;
  }
  return undefined;
}

export function output(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

async function stdinText() {
  let body = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) body += chunk;
  return body;
}

export async function evidenceInput(value) {
  if (!value) return undefined;
  let raw = String(value);
  if (raw === "-") raw = await stdinText();
  else if (raw.startsWith("@")) raw = await fs.readFile(path.resolve(raw.slice(1)), "utf8");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail("--evidence must be JSON, @file, or - for stdin"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("--evidence must be a JSON object");
  return parsed;
}

export async function listRuns() {
  await ensureStateRoot();
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const value = await readState(entry.name.slice(0, -5));
      if (value && value.version === 1) rows.push({
        run_id: value.runId, agent: value.agent, project: value.project, status: value.status,
        workflow_id: value.workflowId, session_label: value.sessionLabel, updated_at: value.updatedAt
      });
    } catch {}
  }
  rows.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  output({ ok: true, runs: rows.slice(0, 100) });
}
