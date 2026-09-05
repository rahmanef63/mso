// NOTHING here may reach the real installs. Every test runs a stub CLI written
// into a temp dir, PATH is narrowed to that dir plus /usr/bin:/bin (the real
// `hermes` and `openclaw` live only in ~/.local/bin, which is excluded), and
// `settle()` asserts the spawned argv[0] is inside the temp dir before any
// assertion is trusted. A real `hermes update` here would rebuild the
// operator's checkout and restart their agent mid-test.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedAppJob } from "./types";

vi.mock("server-only", () => ({}));

// The catalog reads HERMES_HOME at module load and it MOVES the backup source.
// Cleared before the dynamic import below so a set env var cannot point a test
// backup at the real ~/.hermes.
delete process.env.HERMES_HOME;
delete process.env.OPENCLAW_HOME;

const { checkUpdate, setChannel, startRollback, startUninstall, startUpdate } = await import("./update");
const { readManagedAppJob, listManagedAppJobs } = await import("./jobs");
const { listBackups } = await import("./backups");

let home: string;
let bin: string;
const realPath = process.env.PATH ?? "";
const realHome = process.env.HOME;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mapp-update-"));
  bin = path.join(home, "bin");
  await fs.mkdir(bin);
  vi.spyOn(os, "homedir").mockReturnValue(home);
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  // HOME too: resolveCommand() falls back to $HOME/.local/bin when PATH misses.
  process.env.HOME = home;
  for (const id of ["hermes", "openclaw"]) await fs.mkdir(path.join(home, `.${id}`), { recursive: true });
  await fs.writeFile(path.join(home, ".hermes", "config.yaml"), "state: kept\n");
  await fs.writeFile(path.join(home, ".openclaw", "openclaw.json"), "{}");
});

afterEach(async () => {
  process.env.PATH = realPath;
  if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

/** A stub CLI on PATH. `body` is sh because the shell is the TEST's tool, not
 *  the product's — mso never spawns one (`shell: false` everywhere). */
async function stub(name: string, body: string): Promise<void> {
  await fs.writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** A stub that records what it was called with, one argument per line. */
const recorder = (name: string) => stub(name, `printf '%s\\n' "$@" >> ${JSON.stringify(path.join(home, `${name}.argv`))}\necho done`);

async function recorded(name: string): Promise<string[]> {
  const text = await fs.readFile(path.join(home, `${name}.argv`), "utf8").catch(() => "");
  return text.split("\n").filter(Boolean);
}

async function settle(job: ManagedAppJob): Promise<ManagedAppJob> {
  // The stub must be the one that ran. Asserted on every job, not once.
  expect(job.argv[0] ?? bin).toContain(bin);
  for (let i = 0; i < 400; i += 1) {
    const current = await readManagedAppJob(job.id);
    if (current && current.status !== "queued" && current.status !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job never reached a terminal status");
}

const HERMES_CHECK = `
case "$1 $2" in
  "version ") echo "Hermes Agent v0.19.0 (2026.7.20) · upstream a61183b5"; echo "Install method: git";;
  "update --check") echo "→ Fetching from upstream..."; echo "⚕ Update available (behind origin/main).";;
esac`;

const OPENCLAW_STATUS = `
if [ "$1" = "--version" ]; then echo "OpenClaw 2026.7.1-2 (0790d9f)"; exit 0; fi
echo '{"update":{"installKind":"package","registry":{"latestVersion":"2026.8.0"}},"channel":{"value":"stable","label":"stable (default)"},"availability":{"available":true,"latestVersion":null}}'`;

describe("checkUpdate normalises two CLIs that agree on nothing", () => {
  it("reads Hermes' prose into the shared shape", async () => {
    await stub("hermes", HERMES_CHECK);
    const status = await checkUpdate("hermes", true);

    expect(status.currentVersion).toContain("v0.19.0");
    expect(status.installKind).toBe("git");
    expect(status.updateAvailable).toBe(true);
    // Hermes names no target version, so the field stays null rather than
    // carrying a commit count dressed up as one.
    expect(status.latestVersion).toBeNull();
    expect(status.channel).toMatchObject({ value: "main", kind: "branch", switchable: false, available: [] });
    expect(status.capabilities).toMatchObject({ channel: false, dryRun: false, apply: true });
  });

  it("reads OpenClaw's JSON into the same shape", async () => {
    await stub("openclaw", OPENCLAW_STATUS);
    const status = await checkUpdate("openclaw", true);

    expect(status.currentVersion).toBe("OpenClaw 2026.7.1-2 (0790d9f)");
    expect(status.latestVersion).toBe("2026.8.0");
    expect(status.updateAvailable).toBe(true);
    expect(status.channel).toMatchObject({ value: "stable", kind: "channel", switchable: true });
    expect(status.channel.available).toEqual(["stable", "extended-stable", "beta", "dev"]);
    expect(status.capabilities).toMatchObject({ channel: true, dryRun: true });
  });

  it("answers 'not installed' with the command to run, and offers nothing to click", async () => {
    const status = await checkUpdate("hermes", true); // no stub written
    expect(status.error).toContain("not installed");
    expect(status.updateAvailable).toBeNull();
    expect(status.capabilities).toMatchObject({ apply: false, uninstall: false });
    // The recovery command uses MSO's committed checksum-verifying installer,
    // never a mutable upstream curl|bash entrypoint.
    expect(status.capabilities.installCommand).toContain("scripts/managed-app-install");
  });
});

describe("a backup gates the update it is protecting", () => {
  it("snapshots the state dir first, then runs the update", async () => {
    await recorder("hermes");
    const job = await settle(await startUpdate("hermes"));

    expect(job.status).toBe("succeeded");
    expect(await recorded("hermes")).toEqual(["update", "--yes"]);
    const [backup] = await listBackups("hermes");
    expect(backup.reason).toBe("pre-update");
    expect(backup.files).toBe(1);
    expect(await fs.readFile(path.join(home, ".mso", "backups", "hermes", backup.id, "config.yaml"), "utf8")).toBe("state: kept\n");
    // Order is visible in the transcript: the backup lines land before the
    // child's first byte because `prepare` runs before anything spawns.
    expect(job.log.indexOf("pre-update backup")).toBeLessThan(job.log.indexOf("done"));
    expect(job.log).toContain("not in the backup");
  });

  it("aborts the update when the backup fails, without spawning anything", async () => {
    await recorder("hermes");
    await fs.rm(path.join(home, ".hermes"), { recursive: true }); // nothing to copy
    const job = await settle(await startUpdate("hermes"));

    expect(job.status).toBe("failed");
    expect(job.error).toContain("pre-update backup failed, nothing was run");
    expect(job.exitCode).toBeNull();
    expect(await recorded("hermes")).toEqual([]); // the CLI was never invoked
  });

  // The UI polls a job to a terminal status and then starts the next operation
  // (backup then update, restore then pin). That sequence used to lose a race
  // with the job record's own flush and fail with a lock error nobody held.
  it("lets the next operation start the instant the previous one reads as finished", async () => {
    await recorder("openclaw");
    for (let i = 0; i < 8; i += 1) await settle(await startUpdate("openclaw", { dryRun: true }));
  });

  it("skips the backup for a dry run, which writes nothing to snapshot", async () => {
    await recorder("openclaw");
    const job = await settle(await startUpdate("openclaw", { dryRun: true }));

    expect(job.status).toBe("succeeded");
    expect(await recorded("openclaw")).toEqual(["update", "--yes", "--dry-run", "--json"]);
    expect(await listBackups("openclaw")).toEqual([]);
  });
});

describe("uninstall needs the operator to type the app id", () => {
  it("does nothing at all without the exact confirmation", async () => {
    await recorder("hermes");
    for (const wrong of ["", "yes", "HERMES", "openclaw", undefined]) await expect(startUninstall("hermes", wrong)).rejects.toThrow("does not match");
    expect(await recorded("hermes")).toEqual([]);
    expect(await listManagedAppJobs("hermes")).toEqual([]); // no job, no lock, no audit trail to explain
    expect(await listBackups("hermes")).toEqual([]);
  });

  it("backs up first, then runs the non-interactive uninstall", async () => {
    await recorder("openclaw");
    const job = await settle(await startUninstall("openclaw", "openclaw"));

    expect(job.status).toBe("succeeded");
    expect(await recorded("openclaw")).toEqual(["uninstall", "--non-interactive", "--yes", "--service", "--state"]);
    expect((await listBackups("openclaw"))[0]?.reason).toBe("pre-uninstall");
  });

  // Removing the state dir by hand used to leave the app permanently
  // un-uninstallable: the mandatory snapshot ENOENT'd, the job died in prepare
  // and the CLI never ran. Nothing left to protect is not a backup failure.
  it("still runs when the state dir is already gone, and says why there is no snapshot", async () => {
    await recorder("openclaw");
    await fs.rm(path.join(home, ".openclaw"), { recursive: true });
    const job = await settle(await startUninstall("openclaw", "openclaw"));

    expect(job.status).toBe("succeeded");
    expect(await recorded("openclaw")).toEqual(["uninstall", "--non-interactive", "--yes", "--service", "--state"]);
    expect(job.log).toContain("nothing to back up");
    expect(await listBackups("openclaw")).toEqual([]);
  });
});

describe("channel switching", () => {
  it("is an update run for OpenClaw, because upstream persists it no other way", async () => {
    await recorder("openclaw");
    const job = await settle(await setChannel("openclaw", "beta"));

    expect(await recorded("openclaw")).toEqual(["update", "--yes", "--channel", "beta"]);
    expect(job.kind).toBe("update");
    expect((await listBackups("openclaw"))[0]?.reason).toBe("pre-update");
  });

  it("is refused for Hermes, whose --branch rewrites a working tree instead", async () => {
    await recorder("hermes");
    await expect(setChannel("hermes", "beta")).rejects.toThrow("channel switching is not supported for hermes");
    await expect(setChannel("openclaw", "nightly")).rejects.toThrow("unsupported update channel");
    expect(await recorded("hermes")).toEqual([]);
  });
});

describe("a rollback never undoes its own restore", () => {
  it("refuses a Hermes pin instead of running the branch switch that would stash it", async () => {
    await recorder("hermes");
    // `hermes update --branch` stashes local changes before switching
    // (main.py:7053), and a restore leaves ~/.hermes dirty against an unchanged
    // HEAD — the backup prunes `.git`, not the working tree. So the pin would
    // stash the files the restore had just written back, and with our `--yes`
    // that is a non-interactive update: the default re-applies the stash,
    // `non_interactive_local_changes: discard` throws it away, and a conflict
    // ends in `git reset --hard` — while the job still reports success.
    await expect(startRollback("hermes", "2026-07-25T10-11-12-345Z", "main")).rejects.toThrow("is not supported");
    expect(await recorded("hermes")).toEqual([]);
    expect(await listManagedAppJobs("hermes")).toEqual([]); // nothing started, nothing restored
  });

  it("still restores for Hermes without a pin, and still pins for OpenClaw", async () => {
    await recorder("hermes");
    const restore = await startRollback("hermes", "2026-07-25T10-11-12-345Z");
    // Prepare-only: for Hermes the restore IS the whole rollback, so there is
    // no argv at all — nothing can run after the files are back.
    expect(restore.argv).toEqual([]);
    await settle(restore);

    // OpenClaw's pin reinstalls an npm package and never touches the state dir
    // the restore just wrote, so the two compose and the pin stays offered.
    await recorder("openclaw");
    const pinned = await startRollback("openclaw", "2026-07-25T10-11-12-345Z", "2026.7.1-2");
    expect(pinned.argv.slice(1)).toEqual(["update", "--yes", "--tag", "2026.7.1-2"]);
    await settle(pinned);
    // Both jobs name a snapshot that does not exist, so `prepare` fails and the
    // pin never spawns (the restore's own probes may still have) — the argv is
    // what this test is about.
    expect(await recorded("openclaw")).not.toContain("update");
  });
});

describe("previewing a removal", () => {
  // `--yes` cannot be dropped from a preview — both CLIs refuse a headless
  // uninstall without it (update-cli.ts) — so the ONLY thing between "Preview
  // removal" and a real, unbacked-up removal is `--dry-run` being honoured.
  // That is checked against the installed CLI rather than assumed.

  /** A recorder that answers `uninstall --help` with `help` first, so a test
   *  can say what the installed CLI still advertises. */
  const helpRecorder = (name: string, help: string) =>
    stub(name, `if [ "$2" = "--help" ]; then echo ${JSON.stringify(help)}; exit 0; fi
printf '%s\\n' "$@" >> ${JSON.stringify(path.join(home, `${name}.argv`))}
echo ran`);

  it("runs the preview when the CLI still advertises the flag, and takes no backup", async () => {
    await helpRecorder("hermes", "  --yes\n  --dry-run  print what would be removed");
    const job = await settle(await startUninstall("hermes", "hermes", true));

    expect(job.status).toBe("succeeded");
    expect(await recorded("hermes")).toEqual(["uninstall", "--yes", "--dry-run"]);
    expect(await listBackups("hermes")).toEqual([]); // a preview writes nothing to snapshot
  });

  it("refuses the preview when the installed CLI no longer declares --dry-run", async () => {
    // The regression this exists for: upstream drops or renames the flag, and
    // `uninstall --yes --dry-run` becomes `uninstall --yes` plus an unknown
    // argument — a real removal, with the backup deliberately skipped.
    await helpRecorder("hermes", "  --yes\n  --full");
    await expect(startUninstall("hermes", "hermes", true)).rejects.toThrow("previewing a removal is not supported");

    expect(await recorded("hermes")).toEqual([]); // only --help ever ran, and it records nothing
    expect(await listManagedAppJobs("hermes")).toEqual([]);
  });
});

describe("reading the status never probes", () => {
  it("serves an empty shell until something has probed, and the last probe after", async () => {
    await stub("hermes", HERMES_CHECK);
    // A FRESH module instance: the status cache is module state, and other
    // tests in this file have already filled it for both apps.
    vi.resetModules();
    const fresh = await import("./update");
    const cold = fresh.cachedUpdateStatus("hermes");

    expect(cold.checkedAt).toBeNull(); // "nobody has asked yet" — not a version
    expect(cold.currentVersion).toBeNull();
    // What the app supports is still declared, so the panel can render controls.
    expect(cold.capabilities).toMatchObject({ check: true, apply: true, uninstall: true });
    // THE point: a read spawns nothing. `hermes update --check` git-fetches the
    // operator's own checkout twice, and this verb sits outside the CSRF gate,
    // reachable from every sibling origin that shares the session cookie.
    expect(await recorded("hermes")).toEqual([]);

    await fresh.checkUpdate("hermes", true);
    expect(fresh.cachedUpdateStatus("hermes").currentVersion).toContain("v0.19.0");
  });
});

describe("a CLI that cannot be driven still offers the flow that needs no CLI", () => {
  it("keeps rollback available when everything else goes false", async () => {
    const status = await checkUpdate("openclaw", true); // no stub written
    expect(status.error).toContain("not installed");
    expect(status.capabilities).toMatchObject({ check: false, apply: false, dryRun: false, channel: false, uninstall: false });
    // A restore is in-process file copying — no CLI involved — so it stays
    // available exactly when a broken install makes it most useful. Listed
    // explicitly in `unavailable()` so this reads as a decision, not a gap.
    expect(status.capabilities.rollback).toBe(true);
  });
});
