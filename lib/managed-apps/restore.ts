import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BACKUP_SKIPPED_DIRS, backupsRoot, createBackup, isManagedAppBackupId, readBackupManifest, stateDirFor } from "./backups";
import { getManagedAppDefinition } from "./catalog";
import { getManagedApp, assertManagedAppStopped } from "./manager";
import type { ManagedAppDefinition, ManagedAppId } from "./types";
import type { ManagedAppRestoreResult } from "./update-types";

// The only code in the subsystem that writes into an app's own directory, and
// the reason every other file refuses to. Six gates, in this order, before a
// single byte moves:
//
//   1. the app must not be RUNNING,
//   2. the backup id must match the minted stamp pattern (it is a path segment),
//   3. its manifest must name THIS application,
//   4. the manifest's recorded source must be exactly this app's state dir now,
//   5. the state dir must be a real directory, not a symlink, and not $HOME or
//      an ancestor of it,
//   6. no file in the snapshot may land on a symlink in the state dir — checked
//      by walking both trees BEFORE the first byte moves, because a refusal
//      raised mid-copy leaves the directory half-rolled-back.
//
// It OVERWRITES; it never deletes. A snapshot has no node_modules/.venv/.git
// (backups.ts prunes them), so a rename-aside-and-replace restore would strip a
// Hermes checkout of its own git metadata and dependencies and leave a broken
// install. Files created since the snapshot are therefore left in place, and
// the result says so — "rolled back" here means "these files are back as they
// were", not "the directory is as it was".

/** Refusing beats stopping it. A live app holds SQLite WALs and lock files
 *  (`state.db-wal`, `gateway.lock`, `kanban.db`) and would flush its in-memory
 *  state back over whatever we restored; and an MSO that stopped the app itself
 *  would then own the question of restarting it, including when the restore
 *  fails halfway. The operator has a Stop button — this is one click, not a
 *  wizard. */
const RESTORE_BLOCKING_STATES = new Set(["running", "starting", "unhealthy"]);

/** What both installs already use: `stat -c %a ~/.hermes ~/.openclaw` → 700. A
 *  re-created state dir must not be the one thing in the tree that is world
 *  readable. */
const STATE_DIR_MODE = 0o700;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function assertStopped(id: ManagedAppId): Promise<void> {
  const view = await getManagedApp(id);
  // This gate decides whether it is safe to overwrite the app's state directory,
  // so it must fail CLOSED. "not-installed" is not in the blocking set below —
  // correctly, because restoring into an absent app is the case this feature
  // exists for — but that answer is only safe when it is a FACT. When MSO cannot
  // reach the user bus it cannot see user services at all, and an app that is
  // running right now reads exactly like one that was never installed. Restoring
  // then would copy a snapshot over the live state of a running application.
  if (view.diagnostic) throw new Error(`cannot confirm ${view.name} is stopped — refusing to restore. ${view.diagnostic}`);
  if (RESTORE_BLOCKING_STATES.has(view.state)) throw new Error(`${view.name} is ${view.state}; stop it before restoring a backup`);
  await assertManagedAppStopped(id);
}

/** The state dir is GONE — the normal case for the restore that matters most:
 *  `openclaw uninstall --service --state` removes ~/.openclaw outright, and the
 *  pre-uninstall snapshot MSO forces before it is the operator's only way back.
 *  Refusing here made that snapshot unrestorable exactly when it was needed.
 *
 *  Creating it is safe because of GATE 4, not because of anything here: the path
 *  is `stateDirFor(definition)` — catalog plus env, never anything from the
 *  request — and gate 4 has already required the manifest's recorded source to
 *  be that same path. The only directory this can bring into existence is the
 *  app's own.
 *
 *  Deliberately not `mkdir -p`: a missing PARENT is not "the app was
 *  uninstalled", it is a mis-set HERMES_HOME or a volume that did not mount,
 *  and materialising a tree there would drop the restore somewhere the app will
 *  never look while reporting success. */
async function createStateDir(target: string): Promise<void> {
  const parent = path.dirname(target);
  // stat, not lstat: a symlinked $HOME is a legitimate setup, and the realpath
  // + home containment checks below still run on whatever this resolves to.
  if (!(await fs.stat(parent).catch(() => null))?.isDirectory()) {
    throw new Error(`the application state directory is missing and so is its parent (${parent}); nothing was restored`);
  }
  await fs.mkdir(target, { mode: STATE_DIR_MODE });
}

/** Gate 5. The manifest already proved WHICH directory this snapshot belongs
 *  to; this proves the directory is still a plain directory of this app's and
 *  not a link pointed somewhere else since. */
async function resolveTarget(definition: ManagedAppDefinition, recordedSource: string): Promise<string> {
  const target = stateDirFor(definition);
  if (!path.isAbsolute(target)) throw new Error("the application state directory is not an absolute path");
  if (!recordedSource || path.resolve(recordedSource) !== path.resolve(target)) {
    throw new Error("this backup was taken from a different directory than the application uses now");
  }
  const link = await fs.lstat(target).catch(() => null);
  if (!link) await createStateDir(target); // uninstalled: see createStateDir
  // A symlinked state dir would make every write below land wherever it points.
  else if (link.isSymbolicLink()) throw new Error("the application state directory is a symlink; refusing to restore through it");
  else if (!link.isDirectory()) throw new Error("the application state directory is not a directory");
  const real = await fs.realpath(target);
  const home = await fs.realpath(os.homedir()).catch(() => os.homedir());
  // Never write to $HOME itself or anything containing it: a mis-set
  // HERMES_HOME must not turn a restore into a home-directory overwrite.
  if (real === path.parse(real).root || real === home || `${home}${path.sep}`.startsWith(`${real}${path.sep}`)) {
    throw new Error("refusing to restore over the home directory");
  }
  return real;
}

/** Gate 2 + 3 + the containment check on the snapshot itself. */
async function resolveSource(id: ManagedAppId, backupId: string): Promise<{ dir: string; source: string }> {
  if (!isManagedAppBackupId(backupId)) throw new Error("unknown backup");
  const manifest = await readBackupManifest(id, backupId);
  if (!manifest) throw new Error("this backup has no manifest and cannot be verified");
  if (manifest.applicationId !== id) throw new Error(`this backup belongs to ${manifest.applicationId}, not ${id}`);
  const root = await fs.realpath(backupsRoot(id));
  const dir = await fs.realpath(path.join(root, backupId));
  // realpath both sides: a snapshot dir replaced by a link to somewhere else
  // must not become the thing we copy from.
  if (path.dirname(dir) !== root) throw new Error("backup is outside the application backup directory");
  if (!(await fs.lstat(dir)).isDirectory()) throw new Error("backup is not a directory");
  return { dir, source: manifest.source };
}

/** Gate 6: walk the snapshot against the state dir and refuse BEFORE anything
 *  is written if any entry would land on a symlink. The `fs.cp` filter below
 *  catches the same collision, but by then `fs.cp` has already copied
 *  everything it walked past — the refusal that was meant to protect the state
 *  dir left it half snapshot and half its old self, and said nothing about it.
 *  Both checks stay: this one makes the common case atomic, the filter is the
 *  last-ditch guard for a link that appears during the copy.
 *
 *  Affordable: ~14k entries on the larger of the two installs (~0.3 s of
 *  lstats) against a `createBackup` that copies 366 MB of it a moment later. */
async function assertNoSymlinkCollisions(dir: string, target: string): Promise<void> {
  const pending = [""];
  while (pending.length) {
    const rel = pending.pop() as string;
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      // Skipped by the copy for the same reasons, so neither can collide.
      if (entry.isSymbolicLink()) continue;
      if (!rel && entry.name === "manifest.json") continue;
      const next = path.join(rel, entry.name);
      const existing = await fs.lstat(path.join(target, next)).catch(() => null);
      if (existing?.isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${next} (nothing was written)`);
      if (entry.isDirectory()) pending.push(next);
    }
  }
}

export async function restoreManagedAppBackup(id: ManagedAppId, backupId: string, append: (text: string) => void): Promise<ManagedAppRestoreResult> {
  const definition = getManagedAppDefinition(id);
  await assertStopped(id);
  const { dir, source } = await resolveSource(id, backupId);
  const target = await resolveTarget(definition, source);
  await assertNoSymlinkCollisions(dir, target);
  append(`[mso] restoring ${backupId} into ${target}\n`);

  // The undo. Taken AFTER the gates so a refused restore does not litter, and
  // before the first write so the current state is always recoverable.
  const safety = await createBackup(definition, "pre-restore", () => assertStopped(id));
  append(`[mso] current state saved as ${safety.id} (${safety.files ?? "?"} files) before overwriting\n`);
  await assertStopped(id);

  const manifestFile = path.join(dir, "manifest.json");
  let filesRestored = 0;
  let bytesRestored = 0;
  let checkedAt = 0;
  try {
    await fs.cp(dir, target, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
      filter: async (from, to) => {
        if (Date.now() - checkedAt >= 1000) { await assertStopped(id); checkedAt = Date.now(); }
        if (from === manifestFile) return false; // ours, not the app's
        const entry = await fs.lstat(from);
        // A snapshot contains no symlinks by construction; one that appeared
        // since is not something to copy or follow.
        if (entry.isSymbolicLink()) return false;
        const existing = await fs.lstat(to).catch(() => null);
        // `fs.copyFile` opens the destination with O_CREAT|O_TRUNC, which
        // FOLLOWS a symlink — that is how a restore ends up writing outside the
        // state dir. Gate 6 already refused this before anything moved, so
        // reaching here means the link appeared DURING the copy; refuse the
        // rest of the run rather than write through it.
        if (existing?.isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${path.relative(target, to) || to}`);
        if (entry.isFile()) {
          filesRestored += 1;
          bytesRestored += entry.size;
        }
        return true;
      },
    });
  } catch (error) {
    // `fs.cp` stops where it is, so the state dir now holds part of the
    // snapshot and part of what was there before. The undo id has to be in the
    // MESSAGE, not only in the transcript: a failed job shows one status line,
    // and "refusing to write through a symlink" on its own reads like nothing
    // happened.
    throw new Error(`${message(error)} - the state directory is PARTIALLY restored; undo with backup ${safety.id}`);
  }

  const notRestored = [...BACKUP_SKIPPED_DIRS];
  append(`[mso] restored ${filesRestored} files (${(bytesRestored / 1024 / 1024).toFixed(1)} MB)\n`);
  append(`[mso] NOT restored (never in a snapshot): ${notRestored.join(", ")}\n`);
  append("[mso] files created since the snapshot were left in place - a restore overwrites, it does not delete\n");
  append(`[mso] undo this with backup ${safety.id}\n`);
  return { applicationId: id, backupId, target, filesRestored, bytesRestored, safetyBackupId: safety.id, notRestored, overwriteOnly: true };
}
