import { randomUUID } from "node:crypto";
import { runSessionSubagent } from "./subagent-runner";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { CapabilityRunContext } from "@/lib/capabilities/tool";

export const MAX_CONCURRENT_PER_PRINCIPAL = 4;
export const MAX_RETAINED_JOBS = 32;
export const RETENTION_MS = 30 * 60_000;

export type SubagentJobStatus = "running" | "completed" | "failed" | "cancelled" | "expired";

export type SubagentJob = {
  jobId: string;
  principal: string;
  name: string;
  status: SubagentJobStatus;
  startedAt: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  controller?: AbortController;
};

export type SubagentOutcome = {
  subagentId: string;
  name: string;
  status: "completed" | "partial" | "timeout";
  text: string;
  rounds: number;
  toolCalls: Array<{ name: string; ok: boolean }>;
  maxScope: "read" | "write" | "exec";
};

export type SubagentRunnerFn = (input: {
  principal: string;
  parentSessionId: string;
  objective: string;
  name?: string;
  maxScope?: string;
  maxTurns?: number;
  timeoutMs?: number;
  explicitContext?: string;
  capabilities: CapabilityRuntime;
  authority: CapabilityRunContext;
}) => Promise<SubagentOutcome>;

const jobs = new Map<string, SubagentJob>();

function cleanup(now = Date.now()) {
  for (const job of jobs.values()) {
    if (job.status !== "running" && job.finishedAt && (now - Date.parse(job.finishedAt) > RETENTION_MS)) {
      job.status = "expired";
      job.result = undefined;
    }
  }
}

function evictIfFull() {
  if (jobs.size < MAX_RETAINED_JOBS) return;
  let oldestFinished: SubagentJob | undefined;
  for (const job of jobs.values()) {
    if (job.status !== "running" && job.finishedAt) {
      if (!oldestFinished || Date.parse(job.finishedAt) < Date.parse(oldestFinished.finishedAt!)) {
        oldestFinished = job;
      }
    }
  }
  if (oldestFinished) jobs.delete(oldestFinished.jobId);
}

function ownedJob(jobId: string, principal: string): SubagentJob {
  cleanup();
  const job = jobs.get(jobId);
  if (!job || job.principal !== principal) throw new Error("subagent job not found");
  return job;
}

export function publicJob(job: SubagentJob, now = Date.now()) {
  const isFinished = job.status !== "running" && Boolean(job.finishedAt);
  const endMs = isFinished ? Date.parse(job.finishedAt!) : now;
  const elapsedMs = Math.max(0, endMs - Date.parse(job.startedAt));
  return {
    jobId: job.jobId,
    status: job.status,
    name: job.name,
    startedAt: job.startedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.status === "completed" && job.result !== undefined ? { result: job.result } : {}),
    ...(job.status === "failed" && job.error !== undefined ? { error: job.error } : {}),
    elapsedMs,
  };
}

export async function startSubagentJob(
  input: {
    principal: string;
    parentSessionId: string;
    objective: string;
    name?: string;
    maxScope?: string;
    maxTurns?: number;
    timeoutMs?: number;
    explicitContext?: string;
    capabilities: CapabilityRuntime;
    authority: CapabilityRunContext;
  },
  runner: SubagentRunnerFn = runSessionSubagent,
) {
  cleanup();
  const active = [...jobs.values()].filter((j) => j.principal === input.principal && j.status === "running").length;
  if (active >= MAX_CONCURRENT_PER_PRINCIPAL) {
    throw new Error(`Too many active subagent jobs (max ${MAX_CONCURRENT_PER_PRINCIPAL})`);
  }
  evictIfFull();
  const jobId = `subagent_job_${randomUUID()}`;
  const name = String(input.name || "worker").trim().replace(/[\r\n\t]+/g, " ").slice(0, 60) || "worker";
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  const job: SubagentJob = { jobId, principal: input.principal, name, status: "running", startedAt, controller };
  jobs.set(jobId, job);

  const signal = input.authority.signal
    ? AbortSignal.any([controller.signal, input.authority.signal])
    : controller.signal;
  const runAuthority: CapabilityRunContext = { ...input.authority, signal };

  (async () => {
    try {
      const outcome = await runner({ ...input, authority: runAuthority });
      if (controller.signal.aborted) {
        job.status = "cancelled";
      } else if (outcome.status === "completed" || outcome.status === "partial") {
        job.status = "completed";
        job.result = outcome.text;
      } else {
        job.status = "failed";
        job.error = outcome.status === "timeout" ? "subagent timeout" : outcome.text;
      }
    } catch (err) {
      if (controller.signal.aborted) {
        job.status = "cancelled";
      } else {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      job.controller = undefined;
    }
  })();

  return { jobId: job.jobId, name: job.name, startedAt: job.startedAt, status: "running" as const };
}

export function getSubagentJob(jobId: string, principal: string) {
  return publicJob(ownedJob(jobId, principal));
}

export function listSubagentJobs(principal: string, limit = MAX_RETAINED_JOBS, now = Date.now()) {
  cleanup(now);
  return [...jobs.values()]
    .filter((j) => j.principal === principal)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, Math.max(0, limit))
    .map((job) => {
      const isFinished = job.status !== "running" && Boolean(job.finishedAt);
      const endMs = isFinished ? Date.parse(job.finishedAt!) : now;
      const elapsedMs = Math.max(0, endMs - Date.parse(job.startedAt));
      const resultPreview = job.status === "completed" && typeof job.result === "string"
        ? job.result.slice(0, 120)
        : undefined;
      return {
        jobId: job.jobId,
        status: job.status,
        name: job.name,
        startedAt: job.startedAt,
        ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
        elapsedMs,
        ...(resultPreview !== undefined ? { resultPreview } : {}),
      };
    });
}

export function cancelSubagentJob(jobId: string, principal: string) {
  const job = ownedJob(jobId, principal);
  if (job.status === "running" && job.controller) {
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    job.controller.abort(new Error("subagent job cancelled by caller"));
    job.controller = undefined;
  }
  return publicJob(job);
}

export function _resetSubagentJobsForTest() {
  jobs.clear();
}
