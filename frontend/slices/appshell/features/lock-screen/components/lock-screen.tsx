"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { autoLockMinutes, lock, requestUnlock, useLocked } from "../../../lib/lock";

// Fullscreen privacy curtain: blurred backdrop, big clock, click/key unlocks
// (through the consumer guard when one is injected). Owns the idle timer.
// The curtain MOUNTS per lock, so the clock seeds in a lazy initializer
// instead of an effect-driven setState (react-hooks v6).
export function LockScreen() {
  const locked = useLocked();

  // idle auto-lock — any pointer/key activity resets the countdown
  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      const min = autoLockMinutes();
      if (timer) window.clearTimeout(timer);
      if (min) timer = window.setTimeout(lock, min * 60_000);
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "pointermove", "keydown", "wheel"];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, []);

  return locked ? <LockCurtain /> : null;
}

function LockCurtain() {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      void requestUnlock();
    };
    // Defer one frame: the palette Enter that ran "Lock screen" is still
    // bubbling and must not instantly unlock.
    let attached = false;
    const raf = requestAnimationFrame(() => {
      attached = true;
      window.addEventListener("keydown", onKey);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (attached) window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      className="absolute inset-0 z-[var(--z-lock-screen)] flex cursor-pointer flex-col items-center justify-between bg-background/35 px-6 backdrop-blur-2xl"
      style={{ paddingTop: "calc(14vh + var(--sai-top, 0px))", paddingBottom: "calc(10vh + var(--sai-bottom, 0px))" }}
      onClick={() => void requestUnlock()}
    >
      {/* Clock near the top (iPhone-style) rather than dead-center. */}
      <div className="flex flex-col items-center gap-1">
        <div className="text-6xl font-light tracking-tight">
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="text-sm text-muted-foreground">
          {now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="size-3.5" /> Click to unlock
      </div>
    </div>
  );
}
