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
        AppDeck pauses {appId} safely and backs up {support.stateDir} before removing anything. If the backup
        fails, nothing is removed and your app keeps running.
      </p>

      {runnable ? (
        <div className="space-y-2">
          <Label htmlFor={`uninstall-${appId}`} className="text-xs">
            Type <span className="font-mono font-semibold">{appId}</span> to confirm removal
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
            Typing the app name prevents accidental removal. You can preview first without changing anything.
          </p>
          <div className="flex flex-wrap gap-2">
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
              Back up and uninstall {appId}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Automatic uninstall is unavailable for this build. Use the terminal command below.
        </p>
      )}

      {command ? (
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">Advanced: terminal command</summary>
          <div className="pt-2">
            <CommandRow command={command} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
