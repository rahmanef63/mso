"use client";

import { useState } from "react";
import { Download, RefreshCw, ShieldCheck, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ManagedAppId } from "@/lib/managed-apps/types";
import { fmtStamp, supportFor } from "./app-support";
import { ConfirmDialog } from "./confirm-dialog";
import { applyUpdate, switchChannel } from "./update-api";
import { isActive } from "./update-machine";
import type { UpdateCentre } from "./use-update-center";

function Availability({ available }: { available: boolean | null }) {
  if (available === null) return <Badge variant="outline">Not checked</Badge>;
  return available ? <Badge>Update available</Badge> : <Badge variant="secondary">Up to date</Badge>;
}

export function UpdateTab({ appId, centre }: { appId: ManagedAppId; centre: UpdateCentre }) {
  const support = supportFor(appId);
  const [confirming, setConfirming] = useState(false);
  const [pendingChannel, setPendingChannel] = useState<string | null>(null);
  const { status, job } = centre;
  const busy = isActive(job.phase);
  const caps = status?.capabilities ?? null;
  const channel = status?.channel ?? null;
  // `switchable` is the server's call, never guessed here: a branch (Hermes) is
  // named but is not a menu, because switching it rewrites a working tree.
  const channels = channel?.switchable ? channel.available : [];
  const canDryRun = caps?.dryRun ?? support.dryRun;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Availability available={status?.updateAvailable ?? null} />
        {status?.installKind ? <Badge variant="outline">{status.installKind}</Badge> : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Installed</dt>
          <dd className="truncate font-medium">{status?.currentVersion ?? "unknown"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Latest</dt>
          <dd className="truncate font-medium">{status?.latestVersion ?? "unknown"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last checked</dt>
          <dd className="font-medium">{fmtStamp(status?.checkedAt ?? null)}</dd>
        </div>
        {channel ? (
          <div>
            <dt className="text-muted-foreground" id={`${appId}-channel-label`}>
              {channel.kind === "branch" ? "Branch" : "Channel"}
            </dt>
            <dd className="mt-0.5">
              {channels.length ? (
                <Select
                  value={channel.value ?? channels[0]}
                  // Upstream persists a channel only through an update run, so
                  // picking one here IS an update — never silently, on a menu.
                  onValueChange={setPendingChannel}
                  disabled={busy}
                >
                  <SelectTrigger aria-labelledby={`${appId}-channel-label`} className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((option) => (
                      <SelectItem key={option} value={option} className="text-xs">{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-medium" title={channel.reason ?? undefined}>{channel.value ?? "unknown"}</span>
              )}
            </dd>
          </div>
        ) : null}
      </dl>

      {status?.detail ? (
        <p className="rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px] break-words text-muted-foreground">
          {status.detail}
        </p>
      ) : null}
      {channel && !channels.length && channel.reason ? (
        <p className="text-[11px] text-muted-foreground">{channel.reason}</p>
      ) : null}

      {centre.statusError ?? status?.error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {centre.statusError ?? status?.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={centre.check} disabled={centre.checking || busy || caps?.check === false}>
          <RefreshCw className={centre.checking ? "animate-spin" : undefined} aria-hidden />
          Check
        </Button>
        <Button type="button" size="sm" onClick={() => setConfirming(true)} disabled={busy || caps?.apply === false}>
          <Download aria-hidden />
          Update
        </Button>
        {canDryRun ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void centre.run("dry run", () => applyUpdate(appId, { dryRun: true }))}
            disabled={busy}
          >
            <TestTube2 aria-hidden />
            Dry run
          </Button>
        ) : null}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        AppDeck pauses {appId} safely, saves a backup of {support.stateDir}, applies the verified update,
        and restarts it automatically. If anything fails, your previous service is restored.
      </p>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Update ${appId}?`}
        intro="AppDeck handles the full update safely in the background."
        confirmLabel="Back up and update"
        onConfirm={() => void centre.run("update", () => applyUpdate(appId))}
      >
        <ul className="list-disc space-y-1 pl-4">
          <li>AppDeck pauses {appId} and saves a backup of {support.stateDir} first.</li>
          <li>Only reviewed, checksum-verified releases are installed.</li>
          <li>If anything fails, AppDeck restarts your previous setup automatically.</li>
          {canDryRun ? <li>Dry run rehearses the update without changing anything.</li> : null}
        </ul>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingChannel !== null}
        onOpenChange={(open) => !open && setPendingChannel(null)}
        title={`Switch to the ${pendingChannel} channel?`}
        intro="A channel is only persisted by an update run, so this updates the app on that channel."
        confirmLabel="Back up, then update on that channel"
        onConfirm={() => {
          const next = pendingChannel;
          if (next) void centre.run(`switch to ${next}`, () => switchChannel(appId, next));
        }}
      >
        <p>
          Same job as Update: snapshot {support.stateDir}, run the updater, restart the service. The channel
          stays on {channel?.value ?? "its current value"} if the run fails.
        </p>
      </ConfirmDialog>
    </div>
  );
}
