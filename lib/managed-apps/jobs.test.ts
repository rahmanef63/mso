// Every job here runs a Node stub written into a temp $HOME. Nothing in this
// file may touch the real Hermes/OpenClaw installs: a real `update` would
// rebuild the operator's checkout and restart their agent mid-test.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { startManagedAppJob, readManagedAppJob, listManagedAppJobs } = await import("./jobs");
const { MANAGED_APP_JOB_LOG_CAP, liveRecord } = await import("./job-runner");
const { performManagedAppAction } = await import("./manager");
import type { ManagedAppJob } from "./types";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mapp-jobs-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

/** A stub "CLI": argv[0] is this Node binary, so nothing depends on PATH and no
 *  shell is involved even by accident. */
async function stub(name: string, body: string): Promise<string> {
  const file = path.join(home, `${name}.cjs`);
  await fs.writeFile(file, body);
  return file;
}

async function settle(jobId: string): Promise<ManagedAppJob> {
  for (let i = 0; i < 400; i += 1) {
    const job = await readManagedAppJob(jobId);
    if (job && job.status !== "queued" && job.status !== "running") {
      // `finish()` intentionally publishes the terminal status and releases the
      // per-app lock before the final durable flush completes. Tests must wait
      // for that background finalizer before deleting their temporary $HOME, or
      // fs.rm can race writeJobRecord() and intermittently fail with ENOTEMPTY.
      for (let finalize = 0; finalize < 200 && liveRecord(jobId); finalize += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (liveRecord(jobId)) throw new Error("job reached terminal status but finalization did not complete");
      return (await readManagedAppJob(jobId)) ?? job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job never reached a terminal status");
}

describe("a job outlives the request that started it", () => {
  it("returns before the child exits, persists the record, then completes", async () => {
    const script = await stub("slow", 'console.log("step one");setTimeout(() => console.log("step two"), 200);');
    const started = await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] });

    // The caller gets an id while the child is still running — this is the whole
    // reason the layer exists, since the HTTP response cannot wait 30 minutes.
    expect(started.status).toBe("running");
    expect(started.endedAt).toBeNull();
    const file = path.join(home, ".mso", "managed-app-jobs", `${started.id}.json`);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);

    const done = await settle(started.id);
    expect(done.status).toBe("succeeded");
    expect(done.exitCode).toBe(0);
    expect(done.log).toContain("step one");
    expect(done.log).toContain("step two");
    // And it is readable again after the runtime dropped it (disk, not memory).
    expect((await readManagedAppJob(started.id))?.status).toBe("succeeded");
  });

  it("records a non-zero exit as failed and frees the app for the next job", async () => {
    const script = await stub("boom", 'console.error("wheels came off");process.exit(3);');
    const first = await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] });
    const done = await settle(first.id);

    expect(done.status).toBe("failed");
    expect(done.exitCode).toBe(3);
    expect(done.error).toContain("exited with code 3");
    expect(done.log).toContain("wheels came off");
    const second = await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] });
    await settle(second.id);
  });
});

describe("the transcript is redacted and bounded", () => {
  it("redacts a secret even when it is split across two stdout chunks", async () => {
    // The realistic shape of the leak: the CLI prints a config line in pieces,
    // so a regex over each raw chunk would see neither half as a secret.
    const script = await stub("leak", 'process.stdout.write("api_key=");setTimeout(() => console.log("SUPERSECRET"), 40);');
    const job = await settle((await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] })).id);

    expect(job.log).toContain("api_key=[redacted]");
    expect(job.log).not.toContain("SUPERSECRET");
  });

  it("caps a runaway log at the tail and keeps the offset honest", async () => {
    const script = await stub("flood", 'const l="x".repeat(99);for(let i=0;i<5000;i++)console.log(l);console.log("LAST LINE");');
    const job = await settle((await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] })).id);

    expect(job.status).toBe("succeeded");
    expect(job.log.length).toBeLessThanOrEqual(MANAGED_APP_JOB_LOG_CAP);
    expect(job.logOffset).toBeGreaterThan(MANAGED_APP_JOB_LOG_CAP);
    expect(job.log).toContain("LAST LINE"); // the tail is what survives
  });

  it("serves only what is new when polled with the previous offset", async () => {
    const script = await stub("two", 'console.log("alpha");console.log("beta");');
    const job = await settle((await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] })).id);

    const nothingNew = await readManagedAppJob(job.id, job.logOffset);
    expect(nothingNew?.log).toBe("");
    expect(nothingNew?.logOffset).toBe(job.logOffset);
    const fromMiddle = await readManagedAppJob(job.id, "alpha\n".length);
    expect(fromMiddle?.log).toBe("beta\n");
  });
});

describe("one operation per app, jobs and lifecycle actions sharing one lock", () => {
  it("refuses a second job and a lifecycle action while a job runs", async () => {
    const script = await stub("hold", "setTimeout(() => {}, 400);");
    const running = await startManagedAppJob({ applicationId: "openclaw", kind: "update", argv: [process.execPath, script] });

    await expect(startManagedAppJob({ applicationId: "openclaw", kind: "uninstall", argv: [process.execPath, script] })).rejects.toThrow(
      "another operation is already running",
    );
    // Same lock as manager.ts — not a second one that cannot see this job.
    await expect(performManagedAppAction("openclaw", "restart")).rejects.toThrow("another operation is already running");
    // A different app is unaffected: the lock is per app.
    await settle((await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] })).id);
    await settle(running.id);
  });

  it("lists the job that holds the lock even before its record reaches the disk", async () => {
    // The refusal above is what the UI turns into "adopt the running job
    // instead of showing a failure", and it looks the job up through this
    // listing. But a job takes the lock synchronously and only then writes its
    // record (tmp+rename), so on a genuine concurrent double-submit the loser
    // was refused, asked here, and was told nothing was running — the exact
    // state the adoption exists to prevent. Both submits race on purpose:
    // either may win the lock.
    const script = await stub("hold-race", "setTimeout(() => {}, 800);");
    const submit = () =>
      startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script] }).then(
        (job) => ({ id: job.id, seen: [] as string[] }),
        async () => ({ id: "", seen: (await listManagedAppJobs("hermes")).filter((j) => j.status === "running" || j.status === "queued").map((j) => j.id) }),
      );

    const outcomes = await Promise.all([submit(), submit()]);
    const winner = outcomes.find((o) => o.id);
    const loser = outcomes.find((o) => !o.id);
    expect(winner?.id).toBeTruthy();
    expect(loser?.seen).toEqual([winner?.id]);
    await settle(winner?.id ?? "");
  });
});

describe("what never reaches a shell, and what never spawns", () => {
  it("passes a shell-shaped argument through as one literal argv element", async () => {
    const script = await stub("echo", "console.log(process.argv[2]);");
    const job = await settle(
      (await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, script, "; touch pwned"] })).id,
    );

    expect(job.log).toContain("; touch pwned");
    await expect(fs.stat(path.join(home, "pwned"))).rejects.toThrow();
  });

  it("refuses an argument carrying a control character", async () => {
    const argv = [process.execPath, "-e", `console.log(1)${String.fromCharCode(10)}`];
    await expect(startManagedAppJob({ applicationId: "hermes", kind: "update", argv })).rejects.toThrow("not allowed");
  });

  it("aborts before spawning when prepare throws, which is how a failed backup stops an update", async () => {
    const script = await stub("marker", `require("fs").writeFileSync(${JSON.stringify(path.join(home, "ran"))}, "1");`);
    const job = await settle(
      (
        await startManagedAppJob({
          applicationId: "hermes",
          kind: "update",
          argv: [process.execPath, script],
          prepare: async () => {
            throw new Error("backup failed");
          },
        })
      ).id,
    );

    expect(job.status).toBe("failed");
    expect(job.error).toBe("backup failed");
    expect(job.exitCode).toBeNull();
    await expect(fs.stat(path.join(home, "ran"))).rejects.toThrow(); // never spawned
  });

  it("runs a prepare-only job (no child at all) and logs what it appends", async () => {
    const job = await settle(
      (
        await startManagedAppJob({
          applicationId: "hermes",
          kind: "restore",
          prepare: async (append) => append("restored 3 files\n"),
        })
      ).id,
    );

    expect(job.status).toBe("succeeded");
    expect(job.argv).toEqual([]);
    expect(job.log).toContain("restored 3 files");
    const [latest] = await listManagedAppJobs("hermes");
    expect(latest.id).toBe(job.id);
    expect(latest).not.toHaveProperty("log"); // history rows carry no transcript
  });
});
