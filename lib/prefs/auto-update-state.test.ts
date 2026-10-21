import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AUTO_UPDATE_STATE_DEFAULTS, clearAutoUpdatePause, readAutoUpdateState, writeAutoUpdateState } from "./auto-update-state";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-auto-update-"));
  file = path.join(dir, "state.json");
  process.env.MSO_AUTO_UPDATE_STATE = file;
});

afterEach(async () => {
  delete process.env.MSO_AUTO_UPDATE_STATE;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("auto-update runtime state", () => {
  it("reports an untouched host as never-attempted rather than failing", async () => {
    expect(await readAutoUpdateState()).toEqual(AUTO_UPDATE_STATE_DEFAULTS);
    await fs.writeFile(file, "{not json", "utf8");
    expect(await readAutoUpdateState()).toEqual(AUTO_UPDATE_STATE_DEFAULTS);
  });

  it("writes owner-only state and merges patches", async () => {
    await writeAutoUpdateState({ lastAttemptAt: 1_700_000_000_000, lastResult: "failed", consecutiveFailures: 1 });
    await writeAutoUpdateState({ detail: "FAILED: build" });
    const got = await readAutoUpdateState();
    expect(got).toMatchObject({ lastResult: "failed", consecutiveFailures: 1, detail: "FAILED: build" });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it("refuses values it did not produce instead of rendering them", async () => {
    await fs.writeFile(file, JSON.stringify({ lastResult: "great", consecutiveFailures: "many", detail: 42 }), "utf8");
    expect(await readAutoUpdateState()).toMatchObject({ lastResult: null, consecutiveFailures: 0, detail: null });
  });

  it("clears the unattended pause so the gate's own advice can work", async () => {
    // The gate refuses at 2 failures and tells the operator to run `mso update` by
    // hand. Before this reset existed that advice was false: only a SUCCESSFUL
    // unattended run cleared the count, and the gate prevented exactly that.
    await writeAutoUpdateState({ consecutiveFailures: 2, lastResult: "failed", detail: "FAILED: build" });
    await clearAutoUpdatePause();
    const after = await readAutoUpdateState();
    expect(after.consecutiveFailures).toBe(0);
    // Evidence of what happened survives: only the streak is a gate input.
    expect(after.lastResult).toBe("failed");
    expect(after.detail).toBe("FAILED: build");
  });

  it("leaves an already-clear streak alone without rewriting the file", async () => {
    await writeAutoUpdateState({ consecutiveFailures: 0, lastResult: "ok" });
    const before = await fs.stat(file);
    await clearAutoUpdatePause();
    const after = await fs.stat(file);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect((await readAutoUpdateState()).consecutiveFailures).toBe(0);
  });
});
