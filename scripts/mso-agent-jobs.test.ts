import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  formatJobDetail,
  formatJobsBlock,
  parseJobResult,
  parseJobsResult,
} from "./mso-agent-jobs.mjs";

describe("MSO Agent jobs view", () => {
  it("1. a completed job, a running job and an expired job render correctly, with running showing live elapsed time and no NaN", () => {
    const fixedNow = 1_700_000_100_000;
    const jobs = [
      {
        jobId: "subagent_job_c1",
        status: "completed",
        name: "analyzer",
        startedAt: new Date(fixedNow - 5_000).toISOString(),
        finishedAt: new Date(fixedNow - 1_000).toISOString(),
        elapsedMs: 4_000,
        resultPreview: "done",
      },
      {
        jobId: "subagent_job_r1",
        status: "running",
        name: "indexer",
        startedAt: new Date(fixedNow - 3_500).toISOString(),
      },
      {
        jobId: "subagent_job_e1",
        status: "expired",
        name: "collector",
        startedAt: new Date(fixedNow - 60_000).toISOString(),
        finishedAt: new Date(fixedNow - 30_000).toISOString(),
        elapsedMs: 30_000,
      },
      {
        jobId: "subagent_job_no_time",
        status: "completed",
        name: "fallback",
        elapsedMs: Number.NaN,
      },
    ];

    const output = formatJobsBlock(jobs, { now: fixedNow });
    expect(output).not.toContain("NaN");
    expect(output).not.toContain("-");

    expect(output).toContain("subagent_job_c1");
    expect(output).toContain("completed");
    expect(output).toContain("analyzer");
    expect(output).toContain("4s");

    expect(output).toContain("subagent_job_r1");
    expect(output).toContain("running");
    expect(output).toContain("indexer");
    expect(output).toContain("3.5s");

    expect(output).toContain("subagent_job_e1");
    expect(output).toContain("expired");
    expect(output).toContain("collector");
    expect(output).toContain("30s");

    expect(output).toContain("subagent_job_no_time");
    expect(output).toContain("0s");
  });

  it("2. an empty list says so plainly rather than printing an empty frame", () => {
    const output = formatJobsBlock([]);
    expect(output).toBe("no background subagent jobs found");
    expect(formatJobsBlock(null)).toBe("no background subagent jobs found");
  });

  it("3. unparseable result and a non-array payload do not throw", () => {
    expect(() => parseJobsResult("not json {")).not.toThrow();
    expect(parseJobsResult("not json {")).toEqual([]);

    expect(() => parseJobsResult({ error: "some object" })).not.toThrow();
    expect(parseJobsResult({ error: "some object" })).toEqual([]);

    expect(() => parseJobsResult(null)).not.toThrow();
    expect(parseJobsResult(null)).toEqual([]);

    expect(() => parseJobsResult(12345)).not.toThrow();
    expect(parseJobsResult(12345)).toEqual([]);

    expect(() => parseJobResult("invalid json")).not.toThrow();
    expect(parseJobResult("invalid json")).toBeNull();

    expect(() => parseJobResult([1, 2, 3])).not.toThrow();
    expect(parseJobResult([1, 2, 3])).toBeNull();
  });

  it("4. /jobs <id> output includes the result for a completed job", () => {
    const job = {
      jobId: "subagent_job_42",
      status: "completed",
      name: "tester",
      startedAt: "2026-10-30T10:00:00.000Z",
      finishedAt: "2026-10-30T10:00:05.000Z",
      elapsedMs: 5000,
      result: "all unit tests passed successfully with 0 regressions",
    };

    const detail = formatJobDetail(job);
    expect(detail).toContain("subagent_job_42");
    expect(detail).toContain("completed");
    expect(detail).toContain("tester");
    expect(detail).toContain("5s");
    expect(detail).toContain("Result:");
    expect(detail).toContain("all unit tests passed successfully with 0 regressions");
  });

  it("5. maxItems is respected and withheld items are reported", () => {
    const jobs = Array.from({ length: 5 }, (_, i) => ({
      jobId: `job_${i + 1}`,
      status: "running",
      name: `w_${i + 1}`,
      elapsedMs: 1000,
    }));

    const output = formatJobsBlock(jobs, { maxItems: 3 });
    expect(output).toContain("job_1");
    expect(output).toContain("job_3");
    expect(output).not.toContain("job_4");
    expect(output).toContain("… 2 more jobs");
  });

  it("6. formatElapsed handles edge cases cleanly without NaN or negative values", () => {
    expect(formatElapsed(undefined as unknown as number)).toBe("0s");
    expect(formatElapsed(Number.NaN)).toBe("0s");
    expect(formatElapsed(-500)).toBe("0s");
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(250)).toBe("250ms");
    expect(formatElapsed(1500)).toBe("1.5s");
    expect(formatElapsed(65000)).toBe("1m 5s");
  });
});
