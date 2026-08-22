"use client";

import { Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActivities, useShellUI } from "@/features/appshell";

// iPhone Dynamic Island: a top-center pill that appears ONLY while something is
// happening (render, copy, …). Reads the live-activity store; tapping it focuses
// the owning app via the shell surface. Idle → renders nothing.
export function DynamicIsland() {
  const { openAppById } = useShellUI();
  const activities = useActivities();
  const a = activities[activities.length - 1];
  if (!a) return null;

  const pct = typeof a.progress === "number" ? Math.max(0, Math.min(100, a.progress)) : null;
  const tone = a.tone ?? "active";

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-[60] flex justify-center"
      // Sit at the safe-area top so a live activity clears the phone notch
      // (iOS floors --sai-top to the notch height); desktop keeps the 6px inset.
      style={{ top: "max(0.375rem, var(--sai-top))" }}
    >
      <Button
        type="button"
        variant="ghost"
        disabled={!a.appId}
        onClick={() => a.appId && openAppById(a.appId)}
        className="glass h-auto hover:bg-black/85 pointer-events-auto flex max-w-[80%] items-center gap-2.5 rounded-full bg-black/85 px-3.5 py-2 text-white shadow-xl disabled:cursor-default"
        style={{ animation: "mobileAppOpen var(--shell-dur) var(--shell-ease)" }}
      >
        <span className="grid size-5 shrink-0 place-items-center">
          {tone === "done" ? (
            <Check className="size-4 text-success" />
          ) : tone === "error" ? (
            <X className="size-4 text-destructive" />
          ) : pct != null ? (
            <ProgressRing pct={pct} />
          ) : (
            <Loader2 className="size-4 animate-spin" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-tight">
          {a.label}
        </span>
        {a.detail && (
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-white/60">
            {a.detail}
          </span>
        )}
      </Button>
    </div>
  );
}

// Tiny determinate progress ring (no external dep).
function ProgressRing({ pct }: { pct: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="2.4" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        className="text-primary transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}
