"use client";

import { useEffect, useState } from "react";
import { Camera, Flashlight } from "lucide-react";
import { autoLockMinutes, lock, requestUnlock, useLocked } from "../../../lib/lock";
import { useActiveShell } from "../../../registry/shells";
import { IosLockScreen } from "./ios-lock-screen";

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

  const shell = useActiveShell();
  if (!locked) return null;
  return shell.id === "ios" ? <IosLockScreen /> : <LockCurtain />;
}

/** 12-hour clock with no day period, so "PM" cannot wrap onto a second line. */
function lockTime(now: Date): string {
  const hour = now.getHours() % 12 || 12;
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function LockCurtain() {
  const [now, setNow] = useState<Date>(() => new Date());
  const [torch, setTorch] = useState(false);

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
      className="absolute inset-0 z-[var(--z-lock-screen)] flex cursor-pointer flex-col items-center justify-between bg-black/25 px-4 backdrop-blur-2xl"
      style={{ paddingTop: "calc(12vh + var(--sai-top, 0px))", paddingBottom: "calc(4vh + var(--sai-bottom, 0px))" }}
      onClick={() => void requestUnlock()}
    >
      <div className="flex flex-col items-center gap-1 text-white">
        <div data-slot="ios-lock-date" className="text-[20px] font-semibold leading-[25px] tracking-[0.38px] text-white">
          {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
        </div>
        <div data-slot="ios-lock-time" className="whitespace-nowrap text-[96px] font-normal leading-none tracking-normal text-white">
          {lockTime(now)}
        </div>
      </div>
      <div className="flex w-full items-center justify-between">
        <button
          type="button"
          data-slot="ios-lock-flashlight"
          aria-label="Flashlight"
          aria-pressed={torch}
          onClick={(e) => { e.stopPropagation(); setTorch((on) => !on); }}
          className={`glass grid size-12 place-items-center rounded-full border border-white/35 ${torch ? "bg-white text-black" : "bg-white/20 text-white"}`}
        >
          <Flashlight className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          data-slot="ios-lock-camera"
          aria-label="Camera"
          onClick={(e) => e.stopPropagation()}
          className="glass grid size-12 place-items-center rounded-full border border-white/35 bg-white/20 text-white"
        >
          <Camera className="size-5" aria-hidden />
        </button>
      </div>
      {torch && <div className="pointer-events-none absolute inset-0 bg-white/75" />}
    </div>
  );
}
