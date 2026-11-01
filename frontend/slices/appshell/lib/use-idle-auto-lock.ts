"use client";

import { useEffect } from "react";
import { autoLockMinutes, lock } from "./lock";

/**
 * Idle auto-lock timer, owned outside the lock-screen component.
 *
 * Why this is separate: the timer used to live in `LockScreen`'s effect, which only mounted
 * when the feature was eagerly imported. That made the timer a reason to keep the whole lock
 * screen (and its iOS variant, clock and complications) in the first-load bundle — and a
 * security-critical timer that only starts once its UI is loaded is the wrong shape anyway.
 *
 * Armed here, from the shell provider that is always mounted, so deferring the lock screen's
 * *presentation* cannot defer its *protection*. Behaviour is unchanged: any pointer, key or
 * wheel activity re-arms the countdown, and a null preference disarms it.
 *
 * ponytail: re-arms on every qualifying event with a fresh timeout, exactly as the old effect
 * did. A throttled deadline (`deadline = now + min`, checked on tick) would do less work, but it
 * would also change what "idle" means at the boundary; add it if profiling shows this costs
 * anything measurable.
 */
export function useIdleAutoLock(): void {
  useEffect(() => {
    let timer: number | undefined;
    const arm = () => {
      const min = autoLockMinutes();
      if (timer) window.clearTimeout(timer);
      timer = min ? window.setTimeout(lock, min * 60_000) : undefined;
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "pointermove", "keydown", "wheel"];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, []);
}
