"use client";

import Link from "next/link";

import { useAppearance } from "@/lib/appearance";
import { useSession } from "../lib/use-session";

// Always visible, including after navigation; never imply mock metrics are live.
export function SessionModeBanner() {
  const { status, role } = useSession();
  const { tweaks } = useAppearance();
  const live = status === "in" && tweaks.server.mode === "live";
  return (
    <aside
      aria-label="Server connection mode"
      className="fixed left-1/2 top-0 w-max -translate-x-1/2 z-[60] flex max-w-[calc(100vw-1rem)] items-center gap-3 whitespace-nowrap rounded-lg border border-border bg-popover px-3 py-1 text-xs text-popover-foreground shadow-sm md:top-9 md:py-2"
      data-connection-mode={live ? "live" : "mock"}
    >
      <span>{live ? `Live server · ${role}` : "Demo · Mock data only"}</span>
      {status === "out" && (
        <Link prefetch={false} href="/login" className="rounded px-2 py-1 font-semibold text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
          Sign in
        </Link>
      )}
    </aside>
  );
}
