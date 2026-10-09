// Restore is the only code in the subsystem that writes into an app's own
// directory, so most of this file is about what it REFUSES. Everything runs in
// a temp $HOME; nothing here can see the real ~/.hermes or ~/.openclaw.
import { promises as fs, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The app must be stopped, and asking systemd about it in a unit test would be
// asking about the real host's units.
const mocks = vi.hoisted(() => ({ state: { value: "stopped" } }));
vi.mock("./manager", () => ({ getManagedApp: async () => ({ state: mocks.state.value, name: "Hermes" }), assertManagedAppStopped: vi.fn().mockResolvedValue(undefined) }));

delete process.env.HERMES_HOME;

const { restoreManagedAppBackup } = await import("./restore");
const { createBackup, listBackups } = await import("./backups");
const { getManagedAppDefinition } = await import("./catalog");

let home: string;
let state: string;
const lines: string[] = [];
const append = (text: string) => void lines.push(text);
const definition = () => getManagedAppDefinition("hermes");
const restore = (backupId: string) => restoreManagedAppBackup("hermes", backupId, append);

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "mapp-restore-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  mocks.state.value = "stopped";
  lines.length = 0;
  state = path.join(home, ".hermes");
  await fs.mkdir(path.join(state, "node_modules", "pkg"), { recursive: true });
  await fs.mkdir(path.join(state, "sessions"), { recursive: true });
  await fs.writeFile(path.join(state, "config.yaml"), "version: 1\n");
  await fs.writeFile(path.join(state, "sessions", "one.json"), "{}");
  await fs.writeFile(path.join(state, "node_modules", "pkg", "index.js"), "vendor");
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.HERMES_HOME; // one test re-imports the catalog with it set
  await fs.rm(home, { recursive: true, force: true });
});

/** A snapshot directory written by hand — the shape an attacker or a bad copy
 *  would leave behind, which `createBackup` would never produce. */
async function planted(id: string, manifest: Record<string, unknown> | null, files: Record<string, string> = {}): Promise<string> {
  const dir = path.join(home, ".mso", "backups", "hermes", id);
  await fs.mkdir(dir, { recursive: true });
  if (manifest) await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(dir, name), body);
  return dir;
}

const STAMP = "2026-07-25T10-11-12-345Z";

describe("what restore refuses before a byte moves", () => {
  it("refuses a backup id that is not one we minted, without joining it to a path", async () => {
    for (const bad of ["../../../etc", "..", "latest", "2026-07-25", `${STAMP}/x`, ""]) {
      await expect(restore(bad)).rejects.toThrow("unknown backup");
    }
  });

  it("refuses a snapshot whose manifest names another application", async () => {
    await planted(STAMP, { applicationId: "openclaw", source: state, createdAt: STAMP }, { "config.yaml": "version: evil\n" });
    await expect(restore(STAMP)).rejects.toThrow("belongs to openclaw, not hermes");
    expect(await fs.readFile(path.join(state, "config.yaml"), "utf8")).toBe("version: 1\n");
  });

  it("refuses a snapshot with no manifest at all — nothing proves whose it is", async () => {
    await planted(STAMP, null, { "config.yaml": "version: evil\n" });
    await expect(restore(STAMP)).rejects.toThrow("no manifest");
  });

  it("refuses a snapshot taken from a different directory than the app uses now", async () => {
    // The gate that keeps a restore inside the app's OWN state dir: the
    // manifest records where the bytes came from, and that has to still be
    // where they are going.
    await planted(STAMP, { applicationId: "hermes", source: "/tmp/somewhere-else", createdAt: STAMP }, { "config.yaml": "x" });
    await expect(restore(STAMP)).rejects.toThrow("taken from a different directory");
  });

  it("refuses while the app is running rather than stopping it", async () => {
    const backup = await createBackup(definition(), "manual", async () => {});
    for (const live of ["running", "starting", "unhealthy"]) {
      mocks.state.value = live;
      await expect(restore(backup.id)).rejects.toThrow(`is ${live}; stop it before restoring`);
    }
  });

  it("refuses before overwriting when a service restarts during the safety backup", async () => {
    const backup = await createBackup(definition(), "manual", async () => {});
    await fs.writeFile(path.join(state, "config.yaml"), "current state");
    await expect(restoreManagedAppBackup("hermes", backup.id, text => { if (text.includes("current state saved")) mocks.state.value = "running"; })).rejects.toThrow(/stop it/);
    expect(await fs.readFile(path.join(state, "config.yaml"), "utf8")).toBe("current state");
  });

  it("refuses to write through a symlink that points out of the state dir", async () => {
    const outside = path.join(home, "outside.txt");
    await fs.writeFile(outside, "untouched");
    await fs.symlink(outside, path.join(state, "escape"));
    // A snapshot never contains symlinks (backup skips them), so this is a real
    // file landing on a link that was planted in the state dir since.
    await planted(STAMP, { applicationId: "hermes", source: state, createdAt: STAMP }, { escape: "written through the link" });

    await expect(restore(STAMP)).rejects.toThrow("refusing to write through a symlink");
    expect(await fs.readFile(outside, "utf8")).toBe("untouched");
  });

  it("refuses a symlink collision BEFORE the first write, leaving nothing half-restored", async () => {
    // The refusal used to be raised from inside the fs.cp filter, so everything
    // the copy had already walked past was written — the state dir ended up
    // part snapshot, part itself, and the message said only "refusing".
    const outside = path.join(home, "outside.txt");
    await fs.writeFile(outside, "untouched");
    const backup = await createBackup(definition(), "manual", async () => {});
    // A file in the snapshot whose counterpart in the state dir became a link.
    await fs.writeFile(path.join(home, ".mso", "backups", "hermes", backup.id, "token.txt"), "would follow the link");
    await fs.symlink(outside, path.join(state, "token.txt"));
    await fs.writeFile(path.join(state, "config.yaml"), "version: 2\n");
    await fs.writeFile(path.join(state, "sessions", "one.json"), '{"kept":true}');

    await expect(restore(backup.id)).rejects.toThrow("nothing was written");
    expect(await fs.readFile(outside, "utf8")).toBe("untouched");
    // Every file the copy would have walked is untouched...
    expect(await fs.readFile(path.join(state, "config.yaml"), "utf8")).toBe("version: 2\n");
    expect(await fs.readFile(path.join(state, "sessions", "one.json"), "utf8")).toBe('{"kept":true}');
    // ...and the undo snapshot was never even taken, because nothing needs one.
    expect((await listBackups("hermes")).map((entry) => entry.reason)).toEqual(["manual"]);
  });

  it("refuses when a DIRECTORY in the state dir became a link out of the tree", async () => {
    // The worse half of the same escape: `fs.cp` recursing into a link where
    // the snapshot has a directory writes every file under it somewhere else.
    const elsewhere = path.join(home, "elsewhere");
    await fs.mkdir(elsewhere);
    const backup = await createBackup(definition(), "manual", async () => {});
    await fs.rm(path.join(state, "sessions"), { recursive: true, force: true });
    await fs.symlink(elsewhere, path.join(state, "sessions"));

    await expect(restore(backup.id)).rejects.toThrow("refusing to write through a symlink: sessions");
    await expect(fs.stat(path.join(elsewhere, "one.json"))).rejects.toThrow();
  });

  it("leaves no safety backup behind when it refuses", async () => {
    mocks.state.value = "running";
    const backup = await createBackup(definition(), "manual", async () => {});
    await expect(restore(backup.id)).rejects.toThrow();
    expect((await listBackups("hermes")).map((entry) => entry.reason)).toEqual(["manual"]);
  });
});

describe("what a restore actually does", () => {
  it("overwrites the snapshot's files, keeps the current state as an undo, and says what it could not bring back", async () => {
    const backup = await createBackup(definition(), "manual", async () => {});
    await fs.writeFile(path.join(state, "config.yaml"), "version: 2\n");
    await fs.writeFile(path.join(state, "added-later.txt"), "new");
    await fs.writeFile(path.join(state, "node_modules", "pkg", "index.js"), "rebuilt");

    const result = await restore(backup.id);

    expect(await fs.readFile(path.join(state, "config.yaml"), "utf8")).toBe("version: 1\n");
    expect(result.filesRestored).toBe(2); // config.yaml + sessions/one.json
    // A restore overwrites; it does not delete. Files added since the snapshot
    // stay, and so does everything the snapshot never had.
    expect(await fs.readFile(path.join(state, "added-later.txt"), "utf8")).toBe("new");
    expect(await fs.readFile(path.join(state, "node_modules", "pkg", "index.js"), "utf8")).toBe("rebuilt");
    expect(result.notRestored).toContain("node_modules");
    expect(result.overwriteOnly).toBe(true);
    expect(result.target).toBe(await fs.realpath(state));

    // The undo: the state as it was a moment ago, saved before the overwrite.
    const safety = (await listBackups("hermes")).find((entry) => entry.id === result.safetyBackupId);
    expect(safety?.reason).toBe("pre-restore");
    expect(await fs.readFile(path.join(home, ".mso", "backups", "hermes", result.safetyBackupId, "config.yaml"), "utf8")).toBe("version: 2\n");

    const transcript = lines.join("");
    expect(transcript).toContain("NOT restored (never in a snapshot)");
    expect(transcript).toContain("left in place");
    expect(transcript).toContain(result.safetyBackupId);
  });

  it("never copies its own manifest into the application's state dir", async () => {
    const backup = await createBackup(definition(), "manual", async () => {});
    await restore(backup.id);
    await expect(fs.stat(path.join(state, "manifest.json"))).rejects.toThrow();
  });

  it("restores the pre-uninstall snapshot after the uninstall deleted the state dir", async () => {
    // The whole point of the snapshot MSO forces before an uninstall:
    // `openclaw uninstall --service --state` removes ~/.openclaw outright, so
    // by the time anyone wants it back, the directory it names is gone. This
    // used to refuse with "the application state directory does not exist" —
    // the one backup the UI calls the operator's only way back, unrestorable.
    const backup = await createBackup(definition(), "pre-uninstall", async () => {});
    await fs.rm(state, { recursive: true, force: true });

    const result = await restore(backup.id);

    expect(result.filesRestored).toBe(2);
    expect(await fs.readFile(path.join(state, "config.yaml"), "utf8")).toBe("version: 1\n");
    expect(await fs.readFile(path.join(state, "sessions", "one.json"), "utf8")).toBe("{}");
    // Re-created with the mode the installs use, not whatever the umask says.
    expect((await fs.stat(state)).mode & 0o777).toBe(0o700);
  });

  it("will not conjure a whole tree when the PARENT is missing too", async () => {
    // A gone state dir means "uninstalled". A gone parent means a mis-set
    // HERMES_HOME or an unmounted volume, and restoring into a fresh tree there
    // would report success while putting the files where nothing looks.
    process.env.HERMES_HOME = path.join(home, "nowhere", "hermes");
    vi.resetModules();
    const fresh = await import("./restore");
    const freshBackups = await import("./backups");
    const freshCatalog = await import("./catalog");
    await fs.mkdir(path.join(home, "nowhere", "hermes"), { recursive: true });
    await fs.writeFile(path.join(home, "nowhere", "hermes", "config.yaml"), "version: 1\n");
    const backup = await freshBackups.createBackup(freshCatalog.getManagedAppDefinition("hermes"), "pre-uninstall", async () => {});
    await fs.rm(path.join(home, "nowhere"), { recursive: true, force: true });

    await expect(fresh.restoreManagedAppBackup("hermes", backup.id, append)).rejects.toThrow("so is its parent");
    delete process.env.HERMES_HOME;
    vi.resetModules();
  });

  it("names the undo snapshot when a link appears after the scan and the copy stops half-way", async () => {
    // The race the pre-flight cannot close, planted in exactly its window: the
    // transcript line below is written after the undo backup and before the
    // first copy. A refusal here DOES leave the state dir partially rewritten,
    // so the failure has to carry the id that undoes it — the job's status line
    // is one string, and the transcript scrolls.
    const outside = path.join(home, "outside.txt");
    await fs.writeFile(outside, "untouched");
    await planted(STAMP, { applicationId: "hermes", source: state, createdAt: STAMP }, { escape: "written through the link" });
    const racy = (text: string) => {
      lines.push(text);
      if (text.includes("current state saved as")) symlinkSync(outside, path.join(state, "escape"));
    };

    const failure = await restoreManagedAppBackup("hermes", STAMP, racy).catch((error: Error) => error);

    expect(String(failure)).toContain("refusing to write through a symlink");
    expect(String(failure)).toContain("PARTIALLY restored");
    const undo = (await listBackups("hermes")).find((entry) => entry.reason === "pre-restore");
    expect(undo).toBeDefined();
    expect(String(failure)).toContain(`undo with backup ${undo?.id}`);
    expect(await fs.readFile(outside, "utf8")).toBe("untouched");
  });

  it("refuses when the state dir is itself a symlink", async () => {
    const backup = await createBackup(definition(), "manual", async () => {});
    const elsewhere = path.join(home, "moved-hermes");
    await fs.rename(state, elsewhere);
    await fs.symlink(elsewhere, state);
    await expect(restore(backup.id)).rejects.toThrow("is a symlink; refusing to restore through it");
  });
});
