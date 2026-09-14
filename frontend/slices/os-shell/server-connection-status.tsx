"use client";

import Link from "next/link";
import { defineFeature, useActiveShell } from "@/features/appshell";
import { useSession } from "@/features/auth";
import { useAppearance } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import { cn } from "@/lib/utils";

/**
 * One status source, many native placements. AppShell exposes `systemStatus`
 * slots in each shell's own chrome; the MSO consumer supplies the live/mock
 * session state here so generic AppShell never imports auth or server prefs.
 */
function ServerConnectionStatus() {
  const { status, role } = useSession();
  const { tweaks } = useAppearance();
  const shell = useActiveShell();
  if (IS_DEMO) return null; // The dedicated guided-demo banner owns demo-build disclosure.

  const live = status === "in" && tweaks.server.mode === "live";
  const mobile = shell.surface === "mobile";
  const label = live
    ? `${mobile ? "Live" : "Live server"} · ${role ?? "viewer"}`
    : mobile ? "Demo" : "Demo · Mock data only";

  return (
    <div
      aria-label="Server connection mode"
      data-connection-mode={live ? "live" : "mock"}
      data-shell-status={shell.id}
      className={cn(
        "flex max-w-full items-center gap-1.5 whitespace-nowrap text-muted-foreground",
        mobile
          ? "rounded-full border border-border/70 bg-card/80 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur"
          : shell.id === "windows"
            ? "h-8 rounded-md px-2 text-[11px] hover:bg-muted"
            : "rounded-md px-1.5 py-0.5 text-[11px]",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", live ? "bg-success" : "bg-warning")}
      />
      <span className="truncate">{label}</span>
      {status === "out" && !mobile && (
        <Link
          prefetch={false}
          href="/login"
          className="font-semibold text-info underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Sign in
        </Link>
      )}
    </div>
  );
}

export const serverConnectionStatusFeature = defineFeature({
  id: "server-connection-status",
  slots: { systemStatus: ServerConnectionStatus },
});
