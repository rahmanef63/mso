// Composition presets + clip mutation helpers. Pure functions over Composition.

import {
  type Clip,
  type Composition,
  type KfProp,
  type Keyframe,
  type MediaRef,
  type TrackKind,
  TRACK_TINT,
  uid,
} from "./mock-timeline";
import { upsertKey } from "./keyframes";
import { getSettings } from "./settings";
import { finitePositive, REEL_LIMITS } from "./limits";

export type RatioPreset = { label: string; dims: string; w: number; h: number };

export const RATIOS: RatioPreset[] = [
  { label: "16:9", dims: "1920×1080", w: 1920, h: 1080 },
  { label: "9:16", dims: "1080×1920", w: 1080, h: 1920 },
  { label: "1:1", dims: "1080×1080", w: 1080, h: 1080 },
  { label: "4:5", dims: "1080×1350", w: 1080, h: 1350 },
];

export const FRAME_RATES = [24, 30, 60] as const;

const mapClips = (c: Composition, fn: (cl: Clip) => Clip): Composition => ({
  ...c,
  clips: c.clips.map(fn),
});

export const setRatio = (c: Composition, w: number, h: number): Composition => ({ ...c, w, h });

export const patchClip = (c: Composition, id: string, patch: Partial<Clip>): Composition =>
  mapClips(c, (cl) => (cl.id === id ? { ...cl, ...patch } : cl));

export const removeClip = (c: Composition, id: string): Composition => ({
  ...c,
  clips: c.clips.filter((cl) => cl.id !== id),
});

export function duplicateClip(c: Composition, id: string): Composition {
  const src = c.clips.find((cl) => cl.id === id);
  if (!src) return c;
  return { ...c, clips: [...c.clips, { ...src, id: uid("c"), start: src.start + src.len }] };
}

/** Split the clip under (or selected at) the playhead frame into two. */
export function splitAt(c: Composition, frame: number, selId: string | null): Composition {
  const f = Math.round(frame);
  return {
    ...c,
    clips: c.clips.flatMap((cl) => {
      const within = f > cl.start + 1 && f < cl.start + cl.len - 1;
      const targeted = selId ? cl.id === selId : within;
      if (!targeted || !within) return [cl];
      const left = f - cl.start;
      const a: Clip = { ...cl, len: left };
      const b: Clip = { ...cl, id: uid("c"), start: f, len: cl.len - left };
      if (cl.kf) {
        a.kf = {};
        b.kf = {};
        for (const k of Object.keys(cl.kf) as KfProp[]) {
          const keys = cl.kf[k] ?? [];
          const ak = keys.filter((x) => x.t <= left);
          const bk = keys.map((x) => ({ ...x, t: x.t - left })).filter((x) => x.t >= 0);
          if (ak.length) a.kf[k] = ak;
          if (bk.length) b.kf[k] = bk;
        }
      }
      return [a, b];
    }),
  };
}

/** Add a text clip at the playhead on the first text track. */
export function addTextClip(c: Composition, label: string, frame: number): Composition {
  const track = c.tracks.find((t) => t.kind === "text");
  if (!track) return c;
  const clip: Clip = {
    id: uid("c"),
    track: track.id,
    name: label.slice(0, 16) || "Text",
    start: Math.round(frame),
    len: 90,
    color: TRACK_TINT.text,
    kind: "text",
    text: label,
    anim: "rise",
  };
  return { ...c, clips: [...c.clips, clip] };
}

/** Drop a real media clip on the playhead. Audio routes to the audio track,
 *  image/video to the video track. Timed media (video/audio) take their source
 *  duration; images use the editor-settings default length. Extends the comp
 *  duration if the clip runs past it. */
export function addMediaClip(c: Composition, media: MediaRef, name: string, frame: number): Composition {
  const kind: TrackKind = media.type === "audio" ? "audio" : "video";
  const track = c.tracks.find((t) => t.kind === kind);
  if (!track) return c;
  const start = Math.max(0, Math.round(frame));
  const len =
    media.type !== "image" && finitePositive(media.dur) && media.dur <= REEL_LIMITS.maxDurationSeconds
      ? Math.max(1, Math.round(media.dur * c.fps))
      : Math.max(6, Math.round(getSettings().imageDur * c.fps));
  const clip: Clip = {
    id: uid("c"),
    track: track.id,
    name: name.slice(0, 24) || "Clip",
    start,
    len,
    color: TRACK_TINT[kind],
    kind,
    media,
  };
  return { ...c, duration: Math.max(c.duration, start + len), clips: [...c.clips, clip] };
}

/** Clamp a trim window to the media source. `durSec` undefined = no source
 *  (mock clip) → only the floor applies. Returns frame-aligned {srcIn, len}. */
export function clampTrim(
  durSec: number | undefined,
  fps: number,
  srcInSec: number,
  len: number,
  speed = 1,
): { srcIn: number; len: number } {
  const safeFps = finitePositive(fps) ? Math.min(REEL_LIMITS.maxFps, fps) : 30;
  const safeSpeed = finitePositive(speed) ? Math.min(4, Math.max(0.25, speed)) : 1;
  const safeDuration = finitePositive(durSec) && durSec <= REEL_LIMITS.maxDurationSeconds ? durSec : undefined;
  const safeSrcIn = Number.isFinite(srcInSec) ? srcInSec : 0;
  const safeLen = Number.isFinite(len) ? len : 6;
  const srcIn = safeDuration != null ? Math.max(0, Math.min(safeSrcIn, safeDuration)) : Math.max(0, safeSrcIn);
  // At speed S, `len` timeline frames consume len*S/fps source seconds.
  const maxLen = safeDuration != null ? Math.max(6, Math.round(((safeDuration - srcIn) * safeFps) / safeSpeed)) : Infinity;
  return { srcIn, len: Math.max(6, Math.min(safeLen, maxLen)) };
}

/** Set a clip's playback speed, rescaling its timeline length so the SAME source
 *  window plays (faster = shorter clip), NLE-style. Clamped 0.25×–4×. */
export function setSpeed(c: Composition, clipId: string, speed: number): Composition {
  const clip = c.clips.find((cl) => cl.id === clipId);
  if (!clip) return c;
  const s = Math.min(4, Math.max(0.25, speed));
  const len = Math.max(6, Math.round((clip.len * (clip.speed ?? 1)) / s));
  return patchClip(c, clipId, { speed: s, len });
}

/** Set (or clear, frames≤0) a cross-dissolve at a clip's start. The clip is
 *  pulled left to overlap its immediate same-track predecessor by `frames`, so
 *  the dissolve has something to blend from. Clamped to both clip lengths. */
export function setCrossfade(c: Composition, clipId: string, frames: number): Composition {
  const b = c.clips.find((cl) => cl.id === clipId);
  if (!b) return c;
  const prev = c.clips
    .filter((x) => x.track === b.track && x.id !== b.id && x.start < b.start)
    .sort((p, q) => q.start - p.start)[0];
  if (!prev) return c; // first clip on its track — nothing to dissolve from
  const f = Math.max(0, Math.min(frames, prev.len - 1, b.len - 1));
  if (f <= 0) return patchClip(c, clipId, { xfade: undefined, start: prev.start + prev.len });
  return patchClip(c, clipId, { xfade: f, start: prev.start + prev.len - f });
}

/** Does a later same-track clip cross-dissolve in over `clip`'s tail? Such a
 *  clip must stay opaque under the incoming dissolve (no fade-to-black). */
export function isXfadeSource(c: Composition, clip: Clip): boolean {
  return c.clips.some(
    (n) => (n.xfade ?? 0) > 0 && n.track === clip.track && n.id !== clip.id && clip.start <= n.start && n.start < clip.start + clip.len,
  );
}

/** Move a clip onto a different track of the same kind. */
export function moveToTrack(c: Composition, clipId: string, toTrack: string): Composition {
  return patchClip(c, clipId, { track: toTrack });
}

/** Reorder a track one step (-1 = up = closer to the front layer, +1 = down). */
export function moveTrack(c: Composition, id: string, dir: -1 | 1): Composition {
  const i = c.tracks.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= c.tracks.length) return c;
  const tracks = [...c.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  return { ...c, tracks };
}

/** Replace a single keyframe track on a clip (used by AI + props). */
export function setKeyTrack(c: Composition, id: string, k: KfProp, keys: Keyframe[]): Composition {
  return patchClip(c, id, { kf: { ...c.clips.find((cl) => cl.id === id)?.kf, [k]: keys } });
}

export const setKeyframe = (c: Composition, id: string, k: KfProp, t: number, v: number): Composition => {
  const clip = c.clips.find((cl) => cl.id === id);
  return setKeyTrack(c, id, k, upsertKey(clip?.kf?.[k], t, v));
};
