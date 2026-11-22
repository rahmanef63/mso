"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedAppId } from "@/lib/managed-apps/types";
import { fmtBytes, fmtStamp, supportFor } from "./app-support";
import { ConfirmDialog } from "./confirm-dialog";
import { apiMessage, listBackups, rollbackTo, type BackupEntry } from "./update-api";
import { isActive } from "./update-machine";
import type { UpdateCentre } from "./use-update-center";

// Neither CLI has a rollback verb. What exists is our snapshot plus the app's
// own pin (`--tag` / `--branch`), so a rollback here is "restore state, then
// optionally pin the code" — and the panel says so rather than implying the
// snapshot moves the version.
export function RollbackPanel({ appId, centre }: { appId: ManagedAppId; centre: UpdateCentre }) {
  const support = supportFor(appId);
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<BackupEntry | null>(null);
  const [pin, setPin] = useState("");
  const busy = isActive(centre.job.phase);

  const load = useCallback(async () => {
    try {
      const result = await listBackups(appId);
      setSupported(result.supported);
      setBackups(result.backups);
      setError(null);
    } catch (cause) {
      setBackups([]);
      setError(apiMessage(cause));
    }
  }, [appId]);

  useEffect(() => {
    // Deferred a tick so the fetch is not a setState in the effect body.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Snapshots of {support.stateDir}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()} aria-label="Reload backups">
          <RefreshCw aria-hidden />
        </Button>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}

      {!supported ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This build has no backups endpoint. Snapshots taken by the Backup action still live in
          <span className="font-mono"> ~/.mso/backups/{appId}/</span>.
        </p>
      ) : backups === null ? (
        <p className="text-[11px] text-muted-foreground">Loading snapshots…</p>
      ) : backups.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          No snapshots yet. Run <span className="font-medium">Backup</span> on the card above, or start an
          update; one is taken automatically before every update.
        </p>
      ) : (
        <ul className="space-y-2">
          {backups.map((backup) => (
            <li key={backup.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
              <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {fmtStamp(backup.createdAt)}
                  {/* "pre-update" vs "manual" is usually the whole reason one
                      snapshot is the right one to go back to. */}
                  {backup.reason ? <span className="ml-1.5 font-normal text-muted-foreground">{backup.reason}</span> : null}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {fmtBytes(backup.sizeBytes)}
                  {backup.files !== null ? ` · ${backup.files} files` : ""}
                  {backup.source ? ` · ${backup.source}` : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setPin("");
                  setChosen(backup);
                }}
              >
                <History aria-hidden />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A restore <span className="font-medium">overwrites</span> {support.stateDir} with the snapshot after
        snapshotting the current state. It does not delete files created since; those stay, so the result is
        a mix, not the old tree. It also does not bring back what the backup never had (symlinks,{" "}
        <span className="font-mono">node_modules</span>, <span className="font-mono">.venv</span>,{" "}
        <span className="font-mono">.git</span>, <span className="font-mono">.cache</span> and the app&apos;s own{" "}
        <span className="font-mono">backups/</span>), and it does not move the installed code: the version
        stays wherever the last update left it unless you pin one.
      </p>

      <ConfirmDialog
        open={chosen !== null}
        onOpenChange={(open) => !open && setChosen(null)}
        title="Restore this snapshot?"
        intro={`${fmtStamp(chosen?.createdAt ?? null)} · ${fmtBytes(chosen?.sizeBytes ?? null)}`}
        confirmLabel="Back up current state, then restore"
        destructive
        onConfirm={() => {
          const backup = chosen;
          // `pin` stays empty for an app that cannot be pinned — the field is
          // not rendered, and sending one would be refused by the route anyway.
          if (backup) void centre.run("restore", () => rollbackTo(appId, backup.id, pin.trim() || undefined));
        }}
      >
        <ul className="list-disc space-y-1 pl-4">
          <li>The current {support.stateDir} is snapshotted first: that snapshot is the undo.</li>
          <li>Snapshot files overwrite live ones; files added since are left where they are.</li>
          {/* Straight off this snapshot's own manifest — what it never held is
              exactly what restoring it cannot bring back. */}
          {chosen?.skippedDirs.length ? (
            <li>
              Never in this snapshot, so not recreated: <span className="font-mono">{chosen.skippedDirs.join(", ")}</span>
              {chosen.skippedSymlinks ? ` and ${chosen.skippedSymlinks} symlinks` : ""}.
            </li>
          ) : (
            <li>Paths the backup skipped (symlinks, build and cache dirs) are not recreated.</li>
          )}
          <li>
            The app stays on its installed version
            {support.rollbackPin ? "; pin it below if you are undoing an update." : "; this app cannot be pinned here (below)."}
          </li>
        </ul>
        {/* No pin field where a pin would UNDO the restore: for Hermes the only
            pin is a branch switch, and the server refuses one on a rollback for
            the same reason (update.ts). Saying why beats a control that 400s. */}
        {support.rollbackPin ? (
          <div className="space-y-1">
            <Label htmlFor="rollback-pin" className="text-xs">{support.pinLabel} (optional)</Label>
            <Input
              id="rollback-pin"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder={support.pinPlaceholder}
              className="h-8 font-mono text-xs"
            />
            <p className="text-[11px]">{support.pinHint}</p>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">{support.pinHint}</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
