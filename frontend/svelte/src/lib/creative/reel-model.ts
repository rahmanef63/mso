import { clampClipDuration, createReelClip, type ReelClip } from "./creative-state.ts";

export type * from "./reel-model-types.ts";
import type {
  AspectPreset, AspectRatioId, CaptionPosition, CaptionStylePreset, ClipFitMode, ClipFilterPreset,
  ClipTransition, ReelCaption, ReelFps, ReelProjectState, ReelTimelineClip,
} from "./reel-model-types.ts";

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: "9:16", label: "9:16 Vertical", width: 1080, height: 1920, cssRatio: "9 / 16" },
  { id: "16:9", label: "16:9 Landscape", width: 1920, height: 1080, cssRatio: "16 / 9" },
  { id: "1:1", label: "1:1 Square", width: 1080, height: 1080, cssRatio: "1 / 1" },
];

export const FPS_OPTIONS: readonly ReelFps[] = [24, 30, 60];

export const TRANSITION_OPTIONS: readonly { id: ClipTransition; label: string }[] = [
  { id: "cut", label: "Cut" },
  { id: "fade", label: "Fade" },
  { id: "slide", label: "Slide" },
  { id: "zoom", label: "Zoom" },
];

export const FILTER_PRESETS: readonly { id: ClipFilterPreset; label: string; css: string }[] = [
  { id: "none", label: "Original", css: "none" },
  { id: "vivid", label: "Vivid", css: "contrast(1.12) saturate(1.32)" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.15)" },
  { id: "warm", label: "Warm", css: "sepia(0.24) saturate(1.18) brightness(1.03)" },
  { id: "cool", label: "Cool", css: "hue-rotate(-14deg) saturate(1.1) contrast(1.06)" },
  { id: "cinematic", label: "Cinematic", css: "contrast(1.18) saturate(0.88) brightness(0.96)" },
];

export const CAPTION_STYLES: readonly { id: CaptionStylePreset; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "bold", label: "Bold Impact" },
  { id: "highlight", label: "Highlight" },
  { id: "minimal", label: "Minimal" },
];

export const BUILTIN_SAMPLE_CLIPS: readonly {
  title: string;
  durationSec: number;
  caption: string;
  filter: ClipFilterPreset;
  transition: ClipTransition;
  backdropColor: string;
}[] = [
  {
    title: "Opening Hook",
    durationSec: 4,
    caption: "Build faster from any browser",
    filter: "vivid",
    transition: "cut",
    backdropColor: "#1d3557",
  },
  {
    title: "Live Workspace Demo",
    durationSec: 5,
    caption: "Multi-track timeline with instant preview",
    filter: "cinematic",
    transition: "fade",
    backdropColor: "#2a4365",
  },
  {
    title: "Call To Action",
    durationSec: 3,
    caption: "Export storyboard JSON in one click",
    filter: "warm",
    transition: "zoom",
    backdropColor: "#3b2f63",
  },
];

let captionSeq = 0;

function nextCaptionId(): string {
  captionSeq += 1;
  return `cap-${captionSeq}`;
}

export function getAspectPreset(id: AspectRatioId): AspectPreset {
  return ASPECT_PRESETS.find((item) => item.id === id) ?? ASPECT_PRESETS[0]!;
}

export function filterCssForPreset(preset: ClipFilterPreset): string {
  return FILTER_PRESETS.find((item) => item.id === preset)?.css ?? "none";
}

export function formatTimecodePrecise(totalSec: number): string {
  const safe = Number.isFinite(totalSec) && totalSec > 0 ? totalSec : 0;
  const tenths = Math.floor(safe * 10 + 1e-6);
  const wholeSec = Math.floor(tenths / 10);
  const d = tenths % 10;
  const mins = Math.floor(wholeSec / 60);
  const secs = wholeSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${d}`;
}

export function effectiveClipDuration(clip: ReelTimelineClip): number {
  const raw = Math.max(0.5, clip.durationSec - clip.trimInSec - clip.trimOutSec);
  return Math.round(raw * 10) / 10;
}

export function totalTimelineDuration(clips: readonly ReelTimelineClip[]): number {
  let sum = 0;
  for (const clip of clips) {
    sum += effectiveClipDuration(clip);
  }
  return Math.round(sum * 10) / 10;
}

export function createTimelineClip(input: {
  title: string;
  path?: string;
  durationSec?: number;
  caption?: string;
  fit?: ClipFitMode;
  filter?: ClipFilterPreset;
  transition?: ClipTransition;
  externalUrl?: string;
  backdropColor?: string;
}): ReelTimelineClip {
  const base = createReelClip(
    input.title,
    input.path ?? "",
    clampClipDuration(input.durationSec ?? 5),
    input.caption ?? "",
  );
  return {
    ...base,
    trimInSec: 0,
    trimOutSec: 0,
    fit: input.fit ?? "cover",
    filter: input.filter ?? "none",
    transition: input.transition ?? "cut",
    ...(input.externalUrl ? { externalUrl: input.externalUrl } : {}),
    ...(input.backdropColor ? { backdropColor: input.backdropColor } : {}),
  };
}

export function createCaption(input: {
  text: string;
  startSec: number;
  endSec: number;
  position?: CaptionPosition;
  style?: CaptionStylePreset;
  fontSizePx?: number;
  bgPill?: boolean;
}): ReelCaption {
  const start = Math.max(0, Math.round(input.startSec * 10) / 10);
  const end = Math.max(start + 0.5, Math.round(input.endSec * 10) / 10);
  const size = Math.min(36, Math.max(12, Math.round(input.fontSizePx ?? 16)));
  return {
    id: nextCaptionId(),
    text: input.text.trim() || "New caption",
    startSec: start,
    endSec: end,
    position: input.position ?? "bottom",
    style: input.style ?? "classic",
    fontSizePx: size,
    bgPill: input.bgPill ?? true,
  };
}

export function defaultReelProject(): ReelProjectState {
  const clips = BUILTIN_SAMPLE_CLIPS.map((sample) => createTimelineClip(sample));
  const captions = [
    createCaption({ text: "Welcome to MSO Reel Editor", startSec: 0, endSec: 3.8, position: "bottom" }),
    createCaption({ text: "Scrub, trim, split, and export", startSec: 4.2, endSec: 8.8, position: "center", style: "highlight" }),
  ];
  return {
    title: "Untitled Reel",
    aspect: "9:16",
    fps: 30,
    clips,
    captions,
    audio: { path: "", volume: 80, muted: false },
  };
}
