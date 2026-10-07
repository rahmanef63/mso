"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { defineFeature, openWindow } from "@/features/appshell";
import { useSession } from "@/features/auth";
import { IS_DEMO } from "@/lib/demo";
import { hasAvailableUpdate, readStatus } from "./update-status-client";

/**
 * Shell-level "new version" affordance (UX-10) — dock-adjacent, not buried in
 * Account. Settings nav badge (`UpdateNavBadge`) stays as the in-app cue.
 */
function UpdateShellBadge() {
  const { status, role } = useSession();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (IS_DEMO || status !== "in" || role !== "owner") return;
    let alive = true;
    readStatus(true)
      .then((next) => {
        if (alive) setAvailable(hasAvailableUpdate(next));
      })
      .catch(() => {
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, [status, role]);

  if (IS_DEMO || status !== "in" || role !== "owner" || !available) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[var(--z-spotlight)] flex justify-center px-4"
      style={{ bottom: "calc(5.5rem + var(--sai-bottom, 0px))" }}
      data-slot="shell-update-badge"
    >
      <Button
        type="button"
        variant="secondary"
        className="pointer-events-auto h-auto gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2 text-sm shadow-[var(--shadow-win)] backdrop-blur"
        aria-label="New MSO version available — open Settings Updates"
        onClick={() => openWindow("os-settings", "Settings")}
      >
        <ArrowDownToLine className="size-4 shrink-0 text-primary" />
        <span>New version available</span>
        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          Open
        </span>
      </Button>
    </div>
  );
}

export const updateShellBadgeFeature = defineFeature({
  id: "update-shell-badge",
  slots: { overlay: UpdateShellBadge },
});
