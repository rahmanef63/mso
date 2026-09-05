// SERVER-ONLY. Bounded asynchronous shell jobs for MCP operations that legitimately
// outlive exec_run's 30s request budget (tests/builds). Jobs are process-local,
// owner/workflow-bound, output-capped, runtime-capped, and disappear on restart.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { childEnv } from "./child-env";
import { destructiveReason, resolveCwd } from "./exec";
import { HostError } from "./host-error";

const MAX_RUNTIME_MS = 20 * 60_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_ACTIVE_PER_ACTOR = 4;
const RETAIN_MS = 30 * 60_000;
const SHELL = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/bash";

type JobState = "running" | "completed" | "failed" | "cancelled" | "refused";

type ExecJob = {
  id: string;
  actor: string;
  workflowId?: string;
  cwd: string;
  state: JobState;
  startedAt: string;
  finishedAt?: string;
  code?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  outputTruncated: boolean;
  child?: ChildProcessWithoutNullStreams;
  timer?: NodeJS.Timeout;
};

const jobs = new Map<string, ExecJob>();
const ownerKey = (actor?: string) => actor || "mcp:anonymous";

function cleanup(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.state === "running" || !job.finishedAt) continue;
    if (now - Date.parse(job.finishedAt) > RETAIN_MS) jobs.delete(id);
  }
}

function append(job: ExecJob, stream: "stdout" | "stderr", chunk: Buffer) {
  const bytesKey = stream === "stdout" ? "stdoutBytes" : "stderrBytes";
  const current = job[bytesKey];
  const remaining = Math.max(0, MAX_OUTPUT_BYTES - current);
  if (remaining > 0) job[stream] += chunk.subarray(0, remaining).toString("utf8");
  job[bytesKey] = current + chunk.byteLength;
  if (chunk.byteLength > remaining) job.outputTruncated = true;
}

function publicJob(job: ExecJob) {
  return {
    id: job.id,
    state: job.state,
    cwd: job.cwd,
    workflowId: job.workflowId,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    code: job.code,
    signal: job.signal,
    stdout: job.stdout,
    stderr: job.stderr,
    outputTruncated: job.outputTruncated,
  };
}

function ownedJob(id: string, actor?: string, workflowId?: string): ExecJob {
  cleanup();
  const job = jobs.get(id);
  if (
    !job ||
    job.actor !== ownerKey(actor) ||
    (job.workflowId !== undefined && job.workflowId !== workflowId)
  ) {
    throw new HostError("Unknown exec job");
  }
  return job;
}

function terminate(job: ExecJob) {
  const child = job.child;
  if (!child) return;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      setTimeout(() => {
        if (!job.child || job.state === "completed") return;
        try { process.kill(-child.pid!, "SIGKILL"); } catch {}
      }, 2_000).unref();
      return;
    } catch {}
  }
  child.kill("SIGTERM");
}

export async function startExecJob(input: {
  command: string;
  artifactEnv?: Record<string, string>;
  cwd?: string;
  actor?: string;
  workflowId?: string;
}) {
  cleanup();
  if (!input.command.trim()) throw new HostError("Empty command");
  const actor = ownerKey(input.actor);
  const active = [...jobs.values()].filter((job) => job.actor === actor && job.state === "running").length;
  if (active >= MAX_ACTIVE_PER_ACTOR) {
    throw new HostError(`Too many active exec jobs (max ${MAX_ACTIVE_PER_ACTOR})`);
  }
  const cwd = await resolveCwd(input.cwd);
  const blocked = destructiveReason(input.command);
  const job: ExecJob = {
    id: randomUUID(),
    actor,
    workflowId: input.workflowId,
    cwd,
    state: blocked ? "refused" : "running",
    startedAt: new Date().toISOString(),
    stdout: "",
    stderr: blocked ? `refused: ${blocked}` : "",
    stdoutBytes: 0,
    stderrBytes: 0,
    outputTruncated: false,
  };
  jobs.set(job.id, job);
  if (blocked) {
    job.code = 126;
    job.finishedAt = new Date().toISOString();
    return publicJob(job);
  }

  const child = spawn(input.command, {
    cwd,
    env: { ...childEnv(), ...input.artifactEnv } as NodeJS.ProcessEnv,
    shell: SHELL,
    stdio: "pipe",
    detached: process.platform !== "win32",
  });
  job.child = child;
  child.stdout.on("data", (chunk: Buffer) => append(job, "stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append(job, "stderr", chunk));
  job.timer = setTimeout(() => {
    if (job.state !== "running") return;
    job.state = "failed";
    job.stderr += `${job.stderr ? "\n" : ""}[timed out after ${MAX_RUNTIME_MS / 60_000}m]`;
    terminate(job);
  }, MAX_RUNTIME_MS);
  child.on("error", (error) => {
    if (job.state === "running") job.state = "failed";
    job.stderr += `${job.stderr ? "\n" : ""}${error.message}`;
  });
  child.on("close", (code, signal) => {
    if (job.timer) clearTimeout(job.timer);
    job.child = undefined;
    job.timer = undefined;
    job.code = typeof code === "number" ? code : job.state === "cancelled" ? 130 : 1;
    job.signal = signal || undefined;
    if (job.state === "running") job.state = job.code === 0 ? "completed" : "failed";
    job.finishedAt = new Date().toISOString();
  });
  return publicJob(job);
}

export function getExecJob(id: string, actor?: string, workflowId?: string) {
  return publicJob(ownedJob(id, actor, workflowId));
}

export function cancelExecJob(id: string, actor?: string, workflowId?: string) {
  const job = ownedJob(id, actor, workflowId);
  if (job.state !== "running" || !job.child) return publicJob(job);
  job.state = "cancelled";
  terminate(job);
  return publicJob(job);
}
