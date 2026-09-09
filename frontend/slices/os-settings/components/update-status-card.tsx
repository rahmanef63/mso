"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, RefreshCw, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsBlock } from "@/features/shell-settings";
import type { UpdateStatus } from "@/lib/host/self-update";

const OK_MARKER = "UPDATE OK";

export function UpdateStatusSkeleton() {
  return (
    <SettingsBlock className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3 w-52 max-w-[60vw]" />
        </div>
        <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
      </div>
      <Skeleton className="h-3 w-4/5" />
    </SettingsBlock>
  );
}

export function UpdateStatusCard({
  info,
  checking,
  sawRunning,
  error,
  finished,
}: {
  info: UpdateStatus;
  checking: boolean;
  sawRunning: boolean;
  error: string | null;
  finished: "ok" | "failed" | null;
}) {
  const logRef = useRef<HTMLPreElement>(null);
  const ahead = info.ahead ?? 0;
  const behind = info.behind ?? 0;
  const diverged = ahead > 0 && behind > 0;
  const localAhead = ahead > 0 && behind === 0;
  const running = info.running ?? false;
  const pending = (info.pendingBuild ?? false) && behind === 0;
  const logText = info.log?.trim() ?? "";
  const lastAttemptFailed =
    logText.includes("FAILED:") && !logText.includes(OK_MARKER);
  const showLog =
    Boolean(logText) && (running || sawRunning || pending || lastAttemptFailed);

  useEffect(() => {
    if (!running || !logRef.current) return;
    const viewport = logRef.current.closest(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement | null;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [info.log, running]);

  const headline = checking
    ? "Checking for updates…"
    : diverged
      ? "Update blocked — local and remote diverged"
      : localAhead
        ? `${ahead} local commit${ahead > 1 ? "s" : ""} not on origin/main`
        : behind > 0
          ? `${behind} update${behind > 1 ? "s" : ""} available`
          : pending
            ? "A build is pending"
            : "Up to date";

  const stateLabel = running
    ? "Running"
    : finished === "failed" || lastAttemptFailed
      ? "Failed safely"
      : finished === "ok"
        ? "Complete"
        : pending
          ? "Build required"
          : behind > 0
            ? "Available"
            : "Current";

  return (
    <SettingsBlock className="space-y-3 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{headline}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            running {info.buildSha || info.current || "—"}
          </p>
        </div>
        <span className="w-fit shrink-0 rounded-full border border-border/70 bg-secondary px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {stateLabel}
        </span>
      </div>

      {pending && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The checkout is at <span className="font-mono">{info.current}</span>,
          which this running build was not compiled from. Rebuild to run it.
        </p>
      )}
      {info.currentSubject && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {info.currentSubject}
        </p>
      )}
      {diverged && (
        <p className="text-[11px] leading-relaxed text-destructive-text">
          Local main is ahead {ahead} and behind {behind}. MSO will not
          overwrite either side automatically; reconcile or preserve the local
          commits first.
        </p>
      )}
      {localAhead && (
        <p className="text-[11px] leading-relaxed text-amber-500">
          Local main has {ahead} unpushed commit{ahead > 1 ? "s" : ""}; normal
          update is blocked until it is pushed or reconciled.
        </p>
      )}
      {info.supported !== false && !info.remoteChecked && !running && (
        <p className="text-[11px] leading-relaxed text-amber-500">
          Could not reach the remote — this is what was last fetched, not
          necessarily what is on main now.
        </p>
      )}
      {error && (
        <p className="text-[11px] leading-relaxed text-destructive-text">
          {error}
        </p>
      )}
      {finished === "ok" && !running && (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-500">
          <CheckCircle2 className="size-3.5" /> Updated and restarted — reload
          to run the new build.
        </p>
      )}
      {(finished === "failed" || lastAttemptFailed) && !running && (
        <p className="text-[11px] leading-relaxed text-destructive-text">
          The update stopped before deployment. The running build was left
          untouched; the stage that failed is preserved below.
        </p>
      )}

      {showLog && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <TerminalSquare className="size-3.5" /> Build log
            </p>
            <span className="text-[10px] text-muted-foreground">
              {running ? "live · follows latest output" : "last attempt"}
            </span>
          </div>
          <ScrollArea
            className="h-56 rounded-md border border-border/60 bg-background/70 sm:h-64"
            aria-label="Software update build log"
          >
            <pre
              ref={logRef}
              tabIndex={0}
              className="min-w-full p-3 font-mono text-[10px] leading-5 whitespace-pre-wrap break-words text-foreground/85 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {logText || "starting…"}
            </pre>
          </ScrollArea>
        </div>
      )}

      {finished === "ok" && !running && (
        <Button
          type="button"
          size="sm"
          className="w-full [@media(pointer:coarse)]:min-h-[44px]"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="size-4" /> Reload MSO
        </Button>
      )}
    </SettingsBlock>
  );
}
