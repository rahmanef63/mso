"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useActiveShell } from "../../../registry/shells";
import { IosLockScreen } from "./ios-lock-screen";
import { requestUnlock, useLocked } from "../../../lib/lock";

// Fullscreen privacy curtain: blurred backdrop, big clock, click/key unlocks
// (through the consumer guard when one is injected). The idle timer is NOT here: it lives in
// appshell/provider via useIdleAutoLock, so deferring this component cannot defer the auto-lock.
// The curtain MOUNTS per lock, so the clock seeds in a lazy initializer
// instead of an effect-driven setState (react-hooks v6).
export function LockScreen() {
  const locked = useLocked();

  const shell = useActiveShell();
  if (!locked) return null;
  return shell.id === "ios" ? <IosLockScreen /> : <LockCurtain />;
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
