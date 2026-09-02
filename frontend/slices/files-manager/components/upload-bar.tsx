"use client";

import { useActivities } from "@/features/appshell";
import { UPLOAD_ACTIVITY_ID } from "../hooks/use-file-ops";

// Thin determinate upload bar under the toolbar. Desktop shells don't mount the
// Dynamic Island, so Files shows its own progress; both read the same activity
// bus entry (UPLOAD_ACTIVITY_ID), so they stay in lockstep with zero extra state.
export function UploadBar() {
  const activities = useActivities();
  const up = activities.find((a) => a.id === UPLOAD_ACTIVITY_ID);
  if (!up) return null;
  const pct =
    typeof up.progress === "number" ? Math.max(0, Math.min(100, up.progress)) : null;
  const tone =
    up.tone === "error" ? "bg-destructive" : up.tone === "done" ? "bg-success" : "bg-primary";
  return (
    <div className="border-t border-border/60 bg-muted/30 px-3 py-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="truncate">{up.label}</span>
        {pct != null && <span className="tabular-nums">{pct}%</span>}
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${tone} ${pct == null ? "w-1/3 animate-pulse" : ""}`}
          style={pct != null ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}
