import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  startSubagentJob,
  getSubagentJob,
  listSubagentJobs,
  cancelSubagentJob,
  _resetSubagentJobsForTest,
  MAX_CONCURRENT_PER_PRINCIPAL,
  MAX_RETAINED_JOBS,
  RETENTION_MS,
} from "./subagent-jobs";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { CapabilityRunContext } from "@/lib/capabilities/tool";
import type { SubagentOutcome, SubagentRunnerFn } from "./subagent-jobs";

const stubCapabilities: CapabilityRuntime = { list: vi.fn(() => []), invoke: vi.fn() };
const stubAuthority: CapabilityRunContext = { principal: "principal-1", scope: "exec" };
const ok = (text: string): SubagentOutcome => ({ subagentId: "sub-1", name: "worker", status: "completed" as const, text, rounds: 1, toolCalls: [], maxScope: "read" as const });
const base = { principal: "principal-1", parentSessionId: "session-1", objective: "obj", capabilities: stubCapabilities, authority: stubAuthority };

describe("background subagent jobs", () => {
  beforeEach(() => { _resetSubagentJobsForTest(); });

  it("1. start returns a job id and running, and runner was invoked", async () => {
    const runner = vi.fn(async () => ok("ok"));
    const res = await startSubagentJob({ ...base, name: "analyzer" }, runner);
    expect(res.jobId).toMatch(/^subagent_job_/);
    expect(res.name).toBe("analyzer");
    expect(res.status).toBe("running");
    expect(runner).toHaveBeenCalled();
  });

  it("2. status reports completed with result once runner resolves", async () => {
    let resolveRunner!: (val: SubagentOutcome) => void;
    const runner = vi.fn<SubagentRunnerFn>(() => new Promise((resolve) => { resolveRunner = resolve; }));
    const res = await startSubagentJob(base, runner);
    let status = getSubagentJob(res.jobId, "principal-1");
    expect(status.status).toBe("running");
    expect(status.result).toBeUndefined();

    resolveRunner(ok("analysis complete"));
    await new Promise((r) => setTimeout(r, 10));
    status = getSubagentJob(res.jobId, "principal-1");
    expect(status.status).toBe("completed");
    expect(status.result).toBe("analysis complete");
    expect(status.finishedAt).toBeDefined();
    expect(typeof status.elapsedMs).toBe("number");
  });

  it("3. status reports failed with error when runner rejects", async () => {
    const runner = vi.fn(async () => { throw new Error("model context window exceeded"); });
    const res = await startSubagentJob(base, runner);
    await new Promise((r) => setTimeout(r, 10));
    const status = getSubagentJob(res.jobId, "principal-1");
    expect(status.status).toBe("failed");
    expect(status.error).toBe("model context window exceeded");
  });

  it("4. cancel aborts the run and status becomes cancelled", async () => {
    let observedSignal: AbortSignal | undefined;
    const runner = vi.fn<SubagentRunnerFn>(async ({ authority }) => {
      observedSignal = authority.signal;
      return new Promise<SubagentOutcome>((_, reject) => {
        authority.signal?.addEventListener("abort", () => reject(authority.signal?.reason || new Error("aborted")));
      });
    });
    const res = await startSubagentJob(base, runner);
    expect(observedSignal?.aborted).toBe(false);

    const cancelled = cancelSubagentJob(res.jobId, "principal-1");
    expect(cancelled.status).toBe("cancelled");
    expect(observedSignal?.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(getSubagentJob(res.jobId, "principal-1").status).toBe("cancelled");
  });

  it("5. second principal gets not found for another principal's job id", async () => {
    const res = await startSubagentJob(base, vi.fn<SubagentRunnerFn>(() => new Promise(() => {})));
    expect(() => getSubagentJob(res.jobId, "principal-2")).toThrow("subagent job not found");
    expect(() => cancelSubagentJob(res.jobId, "principal-2")).toThrow("subagent job not found");
  });

  it("6. starting beyond concurrent cap fails with clear message", async () => {
    const runner = vi.fn<SubagentRunnerFn>(() => new Promise(() => {}));
    for (let i = 0; i < MAX_CONCURRENT_PER_PRINCIPAL; i++) await startSubagentJob(base, runner);
    await expect(startSubagentJob(base, runner)).rejects.toThrow(`Too many active subagent jobs (max ${MAX_CONCURRENT_PER_PRINCIPAL})`);
  });

  it("7. finished job past retention window reports expired and drops result", async () => {
    const res = await startSubagentJob(base, vi.fn(async () => ok("secret answer")));
    await new Promise((r) => setTimeout(r, 10));
    expect(getSubagentJob(res.jobId, "principal-1").result).toBe("secret answer");

    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + RETENTION_MS + 10_000;
      const status = getSubagentJob(res.jobId, "principal-1");
      expect(status.status).toBe("expired");
      expect(status.result).toBeUndefined();
    } finally { Date.now = originalNow; }
  });

  it("8. total retained jobs capped and oldest finished evicted", async () => {
    let done1!: (v: SubagentOutcome) => void, done2!: (v: SubagentOutcome) => void, callIdx = 0;
    const runner = vi.fn<SubagentRunnerFn>(() => {
      callIdx++;
      if (callIdx === 1) return new Promise((r) => { done1 = r; });
      if (callIdx === 2) return new Promise((r) => { done2 = r; });
      return new Promise(() => {});
    });

    const j1 = await startSubagentJob({ ...base, principal: "p-a" }, runner);
    done1(ok("1"));
    await new Promise((r) => setTimeout(r, 10));
    const j2 = await startSubagentJob({ ...base, principal: "p-a" }, runner);
    done2(ok("2"));
    await new Promise((r) => setTimeout(r, 10));

    const runningIds: string[] = [];
    for (let i = 2; i < MAX_RETAINED_JOBS; i++) {
      const j = await startSubagentJob({ ...base, principal: `p-${i}` }, runner);
      runningIds.push(j.jobId);
    }
    await startSubagentJob({ ...base, principal: "p-new" }, runner);
    expect(() => getSubagentJob(j1.jobId, "p-a")).toThrow("subagent job not found");
    expect(getSubagentJob(j2.jobId, "p-a").status).toBe("completed");
    expect(getSubagentJob(runningIds[0], "p-2").status).toBe("running");
  });

  it("9. listSubagentJobs isolates principals, orders newest first, caps list and truncates resultPreview", async () => {
    const longText = "x".repeat(200);
    const j1 = await startSubagentJob({ ...base, principal: "p-list", name: "first" }, vi.fn(async () => ok(longText)));
    await new Promise((r) => setTimeout(r, 10));
    const j2 = await startSubagentJob({ ...base, principal: "p-list", name: "second" }, vi.fn<SubagentRunnerFn>(() => new Promise(() => {})));
    await startSubagentJob({ ...base, principal: "p-other", name: "other" }, vi.fn<SubagentRunnerFn>(() => new Promise(() => {})));

    const list = listSubagentJobs("p-list");
    expect(list.length).toBe(2);
    expect(list[0].jobId).toBe(j2.jobId);
    expect(list[0].status).toBe("running");
    expect(list[0].resultPreview).toBeUndefined();
    expect((list[0] as Record<string, unknown>).result).toBeUndefined();

    expect(list[1].jobId).toBe(j1.jobId);
    expect(list[1].status).toBe("completed");
    expect(list[1].resultPreview).toBe("x".repeat(120));
    expect((list[1] as Record<string, unknown>).result).toBeUndefined();

    const capped = listSubagentJobs("p-list", 1);
    expect(capped.length).toBe(1);
    expect(capped[0].jobId).toBe(j2.jobId);

    const otherList = listSubagentJobs("p-other");
    expect(otherList.length).toBe(1);
    expect(otherList[0].name).toBe("other");
  });
});
