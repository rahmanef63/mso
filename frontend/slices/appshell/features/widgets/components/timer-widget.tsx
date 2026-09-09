"use client";
import { cn } from "@/lib/utils";
import { Timer as TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "./widget-cards";
const btn = "rounded-lg border border-white/10 bg-black/10 px-2 py-1 text-xs hover:bg-white/10";

// Stopwatch — start/pause/reset. The interval only ticks while running.
export function TimerWidget() {
  const [ms, setMs] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setMs((m) => m + 100), 100);
    return () => clearInterval(t);
  }, [running]);
  const s = Math.floor(ms / 1000);
  const label = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <Card className="pointer-events-auto">
      <div className="mb-2 flex items-center gap-2">
        <TimerIcon className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">Timer</span>
        <span className="ml-auto font-mono text-lg font-bold tabular-nums">{label}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setRunning((r) => !r)} className={cn(btn, "flex-1")}>
          {running ? "Pause" : "Start"}
        </button>
        <button type="button" onClick={() => { setRunning(false); setMs(0); }} className={cn(btn, "flex-1")}>
          Reset
        </button>
      </div>
    </Card>
  );
}

// Embeds a URL in an iframe (frameable content only — CSP + the target's
// X-Frame-Options still apply). URL persists to localStorage.
