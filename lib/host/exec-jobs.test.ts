import { afterEach, describe, expect, it } from "vitest";
import { cancelExecJob, getExecJob, startExecJob } from "./exec-jobs";

const ids: string[] = [];

afterEach(() => {
  for (const id of ids.splice(0)) {
    try {
      cancelExecJob(id, "mcp:test", "w1");
    } catch {
      // A refused/completed job can already be gone only after retention cleanup.
    }
  }
});

async function start(command: string, actor = "mcp:test") {
  const job = await startExecJob({ command, actor, workflowId: "w1" });
  ids.push(job.id);
  return job;
}

async function wait(id: string, actor = "mcp:test") {
  for (let index = 0; index < 100; index += 1) {
    const job = getExecJob(id, actor, "w1");
    if (job.state !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not finish");
}

describe("bounded asynchronous exec jobs", () => {
  it("returns immediately and later exposes captured output", async () => {
    const job = await start("sleep 0.05; printf hello");
    expect(job.state).toBe("running");

    const done = await wait(job.id);
    expect(done).toMatchObject({
      state: "completed",
      code: 0,
      stdout: "hello",
      workflowId: "w1",
      outputTruncated: false,
    });
  });

  it("binds status and cancellation to the creating MCP actor", async () => {
    const job = await start("sleep 2");
    expect(() => getExecJob(job.id, "mcp:other", "w1")).toThrow("Unknown exec job");
    expect(() => getExecJob(job.id, "mcp:test", "w2")).toThrow("Unknown exec job");
    expect(cancelExecJob(job.id, "mcp:test", "w1").state).toBe("cancelled");
  });

  it("uses the same catastrophic-command refusal as exec_run", async () => {
    const dangerous = ["dd if=/dev/zero", "of=/dev/sda"].join(" ");
    const job = await start(dangerous);
    expect(job).toMatchObject({ state: "refused", code: 126 });
    expect(job.stderr).toContain("refused:");
  });

  it("reports non-zero exits without converting them to completed", async () => {
    const job = await start("printf problem >&2; exit 7");
    const done = await wait(job.id);
    expect(done).toMatchObject({ state: "failed", code: 7, stderr: "problem" });
  });
});
