"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Camera, Flashlight } from "lucide-react";
import { requestUnlock } from "../../../lib/lock";
import { lockDate, lockTime } from "./ios-lock-format";
import { IosLockComplications } from "./ios-lock-complications";

function subscribeStandalone(onChange: () => void) {
  const queries = ["(display-mode: standalone)", "(display-mode: fullscreen)"].map((q) => window.matchMedia(q));
  queries.forEach((mq) => mq.addEventListener("change", onChange));
  return () => queries.forEach((mq) => mq.removeEventListener("change", onChange));
}

function standaloneNow(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches;
}

function useStandalone(): boolean {
  return useSyncExternalStore(subscribeStandalone, standaloneNow, () => false);
}

function BatteryPercent() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
    if (!nav.getBattery) return;
    let live = true;
    nav.getBattery().then((battery) => {
      if (!live) return;
      const pct = Math.round(battery.level * 100);
      setLabel(battery.charging ? `${pct}% charging` : `${pct}%`);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!label) return null;
  return <span className="text-[12px] font-normal leading-4">{label}</span>;
}

function LockStatus({ now }: { now: Date }) {
  const standalone = useStandalone();
  return (
    <div
      data-slot="ios-lock-status"
      data-standalone={standalone ? "true" : "false"}
      className="flex shrink-0 items-center justify-between px-5 text-white"
      style={{ height: "var(--sai-top, 0px)" }}
    >
      {standalone ? null : (
        <>
          <span className="text-[15px] font-semibold leading-5 tracking-[-0.23px]">{lockTime(now)}</span>
          <BatteryPercent />
        </>
      )}
    </div>
  );
}

function LockHomeIndicator({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="flex justify-center pt-[5px]" style={{ paddingBottom: "calc(7px + var(--sai-bottom, 0px))" }}>
      <button
        type="button"
        data-slot="ios-lock-home-indicator"
        aria-label="Unlock"
        onClick={(e) => { e.stopPropagation(); onUnlock(); }}
        className="flex min-h-6 items-center justify-center px-12 py-1.5"
      >
        <span className="h-[5px] w-[134px] rounded-full bg-white/75" />
      </button>
    </div>
  );
}

/** iOS 27 lock face on the shell wallpaper. Clock values are the browser's Date. */
export function IosLockFace({ now }: { now: Date }) {
  const [torch, setTorch] = useState(false);
  const unlock = () => void requestUnlock();
  return (
    <div
      data-slot="ios-lock"
      className="absolute inset-0 z-[var(--z-lock-screen)] flex cursor-pointer flex-col text-white"
      onClick={unlock}
    >
      <LockStatus now={now} />
      <div className="flex flex-col items-center pt-3">
        <div data-slot="ios-lock-date" className="text-[20px] font-semibold leading-[25px] tracking-[0.38px]">
          {lockDate(now)}
        </div>
        <div data-slot="ios-lock-time" className="whitespace-nowrap text-[96px] font-normal leading-none tracking-normal">
          {lockTime(now)}
        </div>
        <IosLockComplications now={now} />
      </div>
      <div className="mt-auto flex w-full items-center justify-between px-4 pb-2">
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
      <LockHomeIndicator onUnlock={unlock} />
      {torch && <div className="pointer-events-none absolute inset-0 bg-white/75" />}
    </div>
  );
}

export function IosLockScreen() {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <IosLockFace now={now} />;
}
