"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared widget-card primitives — used by the mobile Today page AND the
// desktop wallpaper-layer widget stack.

export function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// className lets an interactive widget opt back into pointer events — the desktop
// stack wrapper is pointer-events-none, so Notes/Quicklinks pass "pointer-events-auto".
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      // Radius comes from --widget-radius with the mobile default (1rem) as the
      // fallback. Only the desktop widget layer sets that var (→ the window
      // radius token), so desktop widgets read as the same surface family as
      // windows, while mobile Today — which never sets it — is byte-identical.
      // (Border needs no var: the global `* { border-color: --border }` in
      // globals.css already unifies every border to the window edge color.)
      className={cn(
        "min-w-0 max-w-full rounded-[var(--widget-radius,1rem)] border border-white/15 p-3.5 text-foreground backdrop-blur-xl",
        className,
      )}
      data-slot="widget-card"
      style={{ background: "var(--widget-bg, var(--glass-menu))" }}
    >
      {children}
    </div>
  );
}

export function Row({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <span className="text-[12.5px] font-semibold">{label}</span>
      <span className="ml-auto text-[12.5px] font-bold tabular-nums">{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

export function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

// A tiny inline SVG sparkline (filled area + line) — the "shell CPU graph" look
// without a charting dep. `max` fixes the top of the scale (100 for %); omit to
// auto-scale to the data. Reserves height while warming up (<2 points).
export function Sparkline({ data, max }: { data: number[]; max?: number }) {
  const W = 100, H = 32;
  if (data.length < 2) return <div style={{ height: H }} />;
  const hi = Math.max(max ?? 0, ...data, 1);
  const xy = data.map((v, i) => [(i / (data.length - 1)) * W, H - (Math.max(0, v) / hi) * H] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <polyline points={area} fill="var(--primary)" opacity={0.14} stroke="none" />
      <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
