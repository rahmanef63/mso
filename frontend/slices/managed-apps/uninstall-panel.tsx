"use client";

import { useState } from "react";
import { Eye, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/features/appshell";
import type { ManagedAppId } from "@/lib/managed-apps/types";
import { supportFor } from "./app-support";
import { uninstallApp } from "./update-api";
import { isActive } from "./update-machine";
import type { UpdateCentre } from "./use-update-center";

/** Shown when the flow is available as a button AND when it is not — a command
 *  with a copy button beats a button that cannot work. */
function CommandRow({ command }: { command: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-secondary p-2">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-secondary-foreground">{command}</code>
      <CopyButton value={command} label="command" />
    </div>
  );
}

export function UninstallPanel({ appId, centre }: { appId: ManagedAppId; centre: UpdateCentre }) {
  const support = supportFor(appId);
  const [typed, setTyped] = useState("");
  const caps = centre.status?.capabilities ?? null;
  // Both CLIs do have a non-interactive uninstall (verified from `--help`), so
  // the default is a working button; a server that says otherwise wins.
  const runnable = caps?.uninstall ?? true;
  const command = caps?.uninstallCommand ?? support.uninstallCommand;
  const busy = isActive(centre.job.phase);
  const armed = typed.trim() === appId;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] leading-relaxed text-destructive">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p>{support.uninstallEffect}</p>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A snapshot of {support.stateDir} is taken first, in the same operation — if that backup fails,
        nothing is removed. MSO can reinstall the app afterwards, but a fresh install is a fresh install:
        the snapshot is the only thing that brings back this one&apos;s credentials, pairings and history.
      </p>

      <CommandRow command={command} />

      {runnable ? (
        <div className="space-y-2">
          <Label htmlFor={`uninstall-${appId}`} className="text-xs">
            Type <span className="font-mono font-semibold">{appId}</span> to confirm
          </Label>
          <Input
            id={`uninstall-${appId}`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`uninstall-${appId}-hint`}
            className="h-8 font-mono text-xs"
          />
          <p id={`uninstall-${appId}-hint`} className="text-[11px] text-muted-foreground">
            The route requires the same word in the request body, so a mistyped confirmation is refused
            server-side too.
          </p>
          <div className="flex flex-wrap gap-2">
            {/* A preview writes nothing, so it is not behind the typing gate —
                the gate exists to stop an accidental removal, not a listing. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void centre.run("uninstall preview", () => uninstallApp(appId, appId, true))}
            >
              <Eye aria-hidden />
              Preview removal
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!armed || busy}
              onClick={() => {
                setTyped("");
                void centre.run("uninstall", () => uninstallApp(appId, appId));
              }}
            >
              <Trash2 aria-hidden />
              Back up, then uninstall {appId}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This build will not run the uninstall for you — it needs answers MSO cannot give. Run the
          command above in a terminal on the host.
        </p>
      )}
    </div>
  );
}
