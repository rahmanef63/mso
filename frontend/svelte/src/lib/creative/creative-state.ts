import { classifyMediaKind, type MediaKind } from "../media/media-api.ts";

export type ImageAdjustments = {
  brightness: number;
  contrast: number;
  saturate: number;
  rotateDeg: number;
  flipH: boolean;
  flipV: boolean;
};

export type StudioAsset = {
  id: string;
  path: string;
  label: string;
  kind: MediaKind;
  durationSec: number;
};

export type ReelClip = {
  id: string;
  title: string;
  path: string;
  durationSec: number;
  caption: string;
};

export type ActiveReelClip = {
  clip: ReelClip;
  index: number;
  offsetSec: number;
  startSec: number;
};

let sequenceId = 0;

function nextItemId(prefix: string): string {
  sequenceId += 1;
  return `${prefix}-${sequenceId}`;
}

function basenameOf(path: string): string {
  const clean = path.trim().split(/[?#]/, 1)[0] ?? "";
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? clean;
}

export function defaultAdjustments(): ImageAdjustments {
  return {
    brightness: 100,
    contrast: 100,
    saturate: 100,
    rotateDeg: 0,
    flipH: false,
    flipV: false,
  };
}

export function clampPercent(n: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function rotateRight(deg: number): number {
  const base = Number.isFinite(deg) ? Math.round(deg) : 0;
  return (((base + 90) % 360) + 360) % 360;
}

export function buildCssFilter(adj: ImageAdjustments): string {
  const b = clampPercent(adj.brightness, 50, 150);
  const c = clampPercent(adj.contrast, 50, 150);
  const s = clampPercent(adj.saturate, 0, 200);
  return `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
}

export function buildCssTransform(adj: ImageAdjustments): string {
  const deg = Number.isFinite(adj.rotateDeg)
    ? ((Math.round(adj.rotateDeg) % 360) + 360) % 360
    : 0;
  const sx = adj.flipH ? -1 : 1;
  const sy = adj.flipV ? -1 : 1;
  const parts: string[] = [];
  if (deg !== 0) parts.push(`rotate(${deg}deg)`);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

export function createStudioAsset(path: string, durationSec?: number): StudioAsset {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Media path is required.");
  const kind = classifyMediaKind(trimmed);
  const defaultSec = kind === "audio" || kind === "video" ? 10 : kind === "image" ? 5 : 0;
  const rawSec = durationSec === undefined ? defaultSec : durationSec;
  const safeDuration = Number.isFinite(rawSec) ? Math.max(0, Math.round(rawSec)) : 0;
  return {
    id: nextItemId("asset"),
    path: trimmed,
    label: basenameOf(trimmed) || trimmed,
    kind,
    durationSec: safeDuration,
  };
}

export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  if (!Number.isInteger(index) || !Number.isInteger(delta) || delta === 0) return next;
  if (index < 0 || index >= next.length) return next;
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [moved] = next.splice(index, 1);
  if (moved !== undefined) next.splice(target, 0, moved);
  return next;
}

export function totalDurationSec(items: readonly { durationSec: number }[]): number {
  let sum = 0;
  for (const item of items) {
    if (Number.isFinite(item.durationSec) && item.durationSec > 0) {
      sum += item.durationSec;
    }
  }
  return sum;
}

export function clampClipDuration(sec: number): number {
  if (!Number.isFinite(sec)) return 1;
  return Math.min(60, Math.max(1, Math.round(sec)));
}

export function createReelClip(
  title: string,
  path: string,
  durationSec: number,
  caption = "",
): ReelClip {
  const cleanPath = path.trim();
  const cleanTitle = title.trim() || basenameOf(cleanPath) || "Untitled clip";
  return {
    id: nextItemId("clip"),
    title: cleanTitle,
    path: cleanPath,
    durationSec: clampClipDuration(durationSec),
    caption: caption.trim(),
  };
}

export function formatTimecode(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function resolveClipAtTime(
  clips: readonly ReelClip[],
  timeSec: number,
): ActiveReelClip | null {
  if (clips.length === 0) return null;
  const clamped = Number.isFinite(timeSec) && timeSec > 0 ? timeSec : 0;
  let cursor = 0;
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i]!;
    const end = cursor + clip.durationSec;
    if (clamped < end || i === clips.length - 1) {
      const offsetSec = Math.min(clip.durationSec, Math.max(0, clamped - cursor));
      return { clip, index: i, offsetSec, startSec: cursor };
    }
    cursor = end;
  }
  return null;
}
