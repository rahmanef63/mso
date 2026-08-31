// The half of the job layer that has to be right AFTER a deploy: a job whose
// owner process is gone must stop claiming to be running, and must not keep the
// app's lock with it. Nothing here runs a real managed-app command.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isManagedAppJobId, listJobRecords, pruneJobRecords, readJobRecord, writeJobRecord } = await import("./job-store");
const { startManagedAppJob } = await import("./jobs");
const { liveRecord } = await import("./job-runner");
import type { ManagedAppId, ManagedAppJob, ManagedAppJobStatus } from "./types";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mapp-store-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

/** A pid that is guaranteed to be gone: spawnSync has already reaped it. */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid ?? 999_999;
}

function record(over: Partial<ManagedAppJob> = {}): ManagedAppJob {
  const now = new Date().toISOString();
  return {
    id: randomBytes(12).toString("hex"),
    applicationId: "hermes" as ManagedAppId,
    kind: "update",
    argv: ["hermes", "update", "--yes"],
    status: "succeeded" as ManagedAppJobStatus,
    startedAt: now,
    endedAt: now,
    exitCode: 0,
    error: null,
    log: "",
    logOffset: 0,
    runnerId: "abcdef123456",
    serverPid: process.pid,
    updatedAt: now,
    ...over,
  };
}

describe("job ids are filenames, so they are validated as filenames", () => {
  it("accepts only 24 lowercase hex chars", () => {
    expect(isManagedAppJobId(randomBytes(12).toString("hex"))).toBe(true);
    expect(isManagedAppJobId("../../../.ssh/id_ed25519")).toBe(false);
    expect(isManagedAppJobId("ABCDEF012345678901234567")).toBe(false);
    expect(isManagedAppJobId("abc")).toBe(false);
    expect(isManagedAppJobId(42)).toBe(false);
  });

  it("refuses to read a traversal id instead of joining it to a path", async () => {
    await expect(readJobRecord("../../../etc/passwd")).resolves.toBeNull();
  });
});

describe("a job whose owner is gone is interrupted, not running forever", () => {
  it("reconciles a record left running by a process that no longer exists", async () => {
    const stranded = record({ status: "running", endedAt: null, exitCode: null, serverPid: deadPid() });
    await writeJobRecord(stranded);

    const read = await readJobRecord(stranded.id);
    expect(read?.status).toBe("interrupted");
    expect(read?.error).toContain("mso stopped while this job was running");
    expect(read?.endedAt).not.toBeNull();
    // The verdict is persisted, so every later reader agrees without re-deriving.
    const onDisk = JSON.parse(await fs.readFile(path.join(home, ".mso", "managed-app-jobs", `${stranded.id}.json`), "utf8"));
    expect(onDisk.status).toBe("interrupted");
  });

  it("reconciles a record that stopped heart-beating even if the pid is alive", async () => {
    // pid reuse would otherwise let a stale record look live forever.
    const silent = record({ status: "running", endedAt: null, updatedAt: new Date(Date.now() - 120_000).toISOString() });
    await writeJobRecord(silent);
    expect((await readJobRecord(silent.id))?.status).toBe("interrupted");
  });

  it("leaves a fresh record from a live process alone", async () => {
    const alive = record({ status: "running", endedAt: null, exitCode: null });
    await writeJobRecord(alive);
    expect((await readJobRecord(alive.id))?.status).toBe("running");
  });

  it("does not let a dead job hold the app's lock across a restart", async () => {
    // The failure this prevents: deploy mid-update, and Hermes can never be
    // updated again because a JSON file still says `running`.
    await writeJobRecord(record({ status: "running", endedAt: null, exitCode: null, serverPid: deadPid() }));
    const next = await startManagedAppJob({ applicationId: "hermes", kind: "update", argv: [process.execPath, "-e", "0"] });
    expect(next.status).toBe("running");
    for (let i = 0; i < 200 && (await readJobRecord(next.id))?.status === "running"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Drain the job's whole finalization, including retention. A fixed sleep was
    // racy under load and let a late prune observe the next test's mocked HOME.
    for (let i = 0; i < 200 && liveRecord(next.id); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(liveRecord(next.id)).toBeUndefined();
  });
});

describe("retention keeps the history from growing forever", () => {
  it("keeps the newest 20 finished jobs per app", async () => {
    const written: string[] = [];
    for (let i = 0; i < 24; i += 1) {
      const job = record({ startedAt: new Date(Date.now() - i * 60_000).toISOString() });
      await writeJobRecord(job);
      written.push(job.id); // index 0 = newest
    }
    await pruneJobRecords();

    const kept = (await listJobRecords("hermes")).map((r) => r.id);
    expect(kept).toHaveLength(20);
    expect(kept).toEqual(written.slice(0, 20));
  });

  it("drops anything past the age limit and never a live job", async () => {
    const old = record({ startedAt: new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString() });
    const running = record({ applicationId: "openclaw" as ManagedAppId, status: "running", endedAt: null, exitCode: null });
    await writeJobRecord(old);
    await writeJobRecord(running);
    await writeJobRecord(record());

    expect(await pruneJobRecords()).toBe(1);
    expect((await listJobRecords()).map((r) => r.id)).not.toContain(old.id);
    expect((await listJobRecords("openclaw")).map((r) => r.id)).toContain(running.id);
  });
});
