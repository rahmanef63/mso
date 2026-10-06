"use client";

import { useSystemStats } from "../../../registry/capabilities";
import { lockZone } from "./ios-lock-format";
import { type LockWeather } from "./ios-lock-weather";

function Ring({ r, pct }: { r: number; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <circle
      cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" pathLength={100} strokeDasharray={`${clamped} 100`}
      transform="rotate(-90 18 18)"
    />
  );
}

function ActivityRings() {
  const stats = useSystemStats();
  const cpu = stats?.cpu.pct ?? 0;
  const mem = stats && stats.mem.total > 0 ? (stats.mem.used / stats.mem.total) * 100 : 0;
  const disk = stats && stats.disk.total > 0 ? (stats.disk.used / stats.disk.total) * 100 : 0;
  const label = stats
    ? `Activity, CPU ${Math.round(cpu)} percent, memory ${Math.round(mem)} percent, storage ${Math.round(disk)} percent`
    : "Activity unavailable";
  return (
    <div data-slot="ios-lock-rings" data-state={stats ? "ready" : "unavailable"} className="grid size-[72px] shrink-0 place-items-center rounded-full glass bg-[var(--glass-bar)] text-white" aria-label={label}>
      <svg viewBox="0 0 36 36" className="size-14" aria-hidden>
        <g className="text-white/30">
          <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="18" cy="18" r="12" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="18" cy="18" r="8" fill="none" stroke="currentColor" strokeWidth="2.4" />
        </g>
        <g className={stats ? "text-white" : "text-transparent"}>
          <Ring r={16} pct={cpu} />
          <g className="opacity-70"><Ring r={12} pct={mem} /></g>
          <g className="opacity-45"><Ring r={8} pct={disk} /></g>
        </g>
      </svg>
    </div>
  );
}

function hand(cx: number, cy: number, length: number, degrees: number): string {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return `M ${cx} ${cy} L ${cx + Math.cos(rad) * length} ${cy + Math.sin(rad) * length}`;
}

function AnalogClock({ now }: { now: Date }) {
  const hours = (now.getHours() % 12) + now.getMinutes() / 60;
  const minutes = now.getMinutes() + now.getSeconds() / 60;
  const zone = lockZone(now);
  return (
    <div data-slot="ios-lock-analog" className="grid size-[72px] shrink-0 place-items-center rounded-full glass bg-[var(--glass-bar)] text-white" aria-label={zone ? `Clock, ${zone}` : "Clock"}>
      <svg viewBox="0 0 36 36" className="size-14" aria-hidden>
        <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="1" className="text-white/50" />
        <path d={hand(18, 18, 7, hours * 30)} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d={hand(18, 18, 11, minutes * 6)} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="18" cy="18" r="1.2" fill="currentColor" />
      </svg>
    </div>
  );
}

export function IosLockComplications({ now, weather }: { now: Date; weather: LockWeather }) {
  return (
    <div data-slot="ios-lock-complications" className="mt-4 flex w-full max-w-[360px] items-center gap-3 px-4">
      <div data-slot="ios-lock-weather" data-state={weather.status} className="flex h-[72px] min-w-0 flex-1 items-center rounded-[22px] glass bg-[var(--glass-bar)] px-3 text-[15px] leading-5 text-white">
        Weather unavailable
      </div>
      <ActivityRings />
      <AnalogClock now={now} />
    </div>
  );
}
