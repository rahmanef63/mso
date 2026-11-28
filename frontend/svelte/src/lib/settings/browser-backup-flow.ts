// The import/export state machine behind Settings → Browser backup.
//
// Kept out of the component so confirm and cancel are provable without a browser:
// the decision "write nothing until the user confirms, and never reload unless the
// write landed" is the part worth a test, and it is pure apart from two injected
// capabilities (storage and reload).

import {
  backupFilename,
  collectBrowserPrefs,
  parseBrowserBackup,
  restoreBrowserPrefs,
  type BrowserPrefsBlob,
  type SkippedKey,
  type StorageLike,
} from "./browser-backup.ts";

export type PendingImport = { file: string; blob: BrowserPrefsBlob; accepted: string[]; skipped: SkippedKey[] };

export type BackupSnapshot = {
  pending: PendingImport | null;
  notice: string | null;
  error: string | null;
};

export type ExportOutcome =
  | { ok: true; filename: string; json: string; count: number; excluded: string[] }
  | { ok: false; error: string };

export type ConfirmOutcome = { ok: true; restored: string[] } | { ok: false; error: string };

export function createBrowserBackupFlow(deps: {
  storage: () => StorageLike | null;
  reload: () => void;
  appVersion: string;
  now?: () => Date;
}) {
  let pending: PendingImport | null = null;
  let notice: string | null = null;
  let error: string | null = null;

  const snapshot = (): BackupSnapshot => ({ pending, notice, error });

  /** Reads storage and hands back the file contents. Writing the file is the
   *  caller's job, because the anchor rules are a DOM concern. */
  function exportBackup(): ExportOutcome {
    notice = null;
    const storage = deps.storage();
    if (!storage) return { ok: false, error: "This browser does not allow local storage, so there is nothing to export." };
    const { blob, excluded } = collectBrowserPrefs(storage, deps.appVersion, (deps.now ?? (() => new Date()))());
    if (Object.keys(blob.keys).length === 0) {
      return { ok: false, error: "This browser holds none of the preferences MSO can back up yet." };
    }
    return {
      ok: true,
      filename: backupFilename((deps.now ?? (() => new Date()))()),
      json: JSON.stringify(blob, null, 2),
      count: Object.keys(blob.keys).length,
      excluded,
    };
  }

  /** Stages a file for confirmation. Nothing is written here, so a file the user
   *  then walks away from leaves their preferences untouched. */
  function openFile(name: string, text: string): { ok: boolean; error?: string } {
    pending = null;
    error = null;
    notice = null;
    const res = parseBrowserBackup(text);
    if (!res.ok) {
      error = res.error;
      return { ok: false, error: res.error };
    }
    if (res.accepted.length === 0) {
      error = "Nothing in that file can be restored by this build.";
      return { ok: false, error };
    }
    pending = { file: name, blob: res.blob, accepted: res.accepted, skipped: res.skipped };
    return { ok: true };
  }

  function cancel(): void {
    pending = null;
  }

  /** The only path that writes. Reloads only after every key landed. */
  function confirm(): ConfirmOutcome {
    if (!pending) return { ok: false, error: "No backup is waiting to be imported." };
    const res = restoreBrowserPrefs(pending.blob, deps.storage());
    pending = null;
    if (!res.ok) {
      const outcome = { ok: false as const, error: res.error + (res.rolledBack ? "" : " Some values may not have been restored.") };
      error = outcome.error;
      return outcome;
    }
    notice = `Restored ${res.restored.length} ${res.restored.length === 1 ? "preference" : "preferences"}. Reloading…`;
    // A full reload, not a state refresh: the shell reads storage once at module
    // init, so anything less leaves the cockpit on the pre-import values.
    deps.reload();
    return { ok: true, restored: res.restored };
  }

  function setNotice(message: string | null): void {
    notice = message;
  }

  function setError(message: string | null): void {
    error = message;
  }

  return { snapshot, exportBackup, openFile, confirm, cancel, setNotice, setError };
}
