import type { ReelClip } from "./creative-state.ts";

export type AspectRatioId = "9:16" | "16:9" | "1:1";
export type ReelFps = 24 | 30 | 60;
export type ClipTransition = "cut" | "fade" | "slide" | "zoom";
export type ClipFitMode = "cover" | "contain";
export type ClipFilterPreset = "none" | "vivid" | "mono" | "warm" | "cool" | "cinematic";
export type CaptionPosition = "top" | "center" | "bottom";
export type CaptionStylePreset = "classic" | "bold" | "highlight" | "minimal";

export type AspectPreset = {
  id: AspectRatioId;
  label: string;
  width: number;
  height: number;
  cssRatio: string;
};

export type ReelTimelineClip = ReelClip & {
  trimInSec: number;
  trimOutSec: number;
  fit: ClipFitMode;
  filter: ClipFilterPreset;
  transition: ClipTransition;
  externalUrl?: string;
  backdropColor?: string;
};

export type ReelCaption = {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  position: CaptionPosition;
  style: CaptionStylePreset;
  fontSizePx: number;
  bgPill: boolean;
};

export type ReelAudioTrack = {
  path: string;
  volume: number;
  muted: boolean;
};

export type ReelProjectState = {
  title: string;
  aspect: AspectRatioId;
  fps: ReelFps;
  clips: ReelTimelineClip[];
  captions: ReelCaption[];
  audio: ReelAudioTrack;
};

export type ActiveTimelineClip = {
  clip: ReelTimelineClip;
  index: number;
  startSec: number;
  endSec: number;
  offsetSec: number;
  durationSec: number;
  inTransition: boolean;
  transitionProgress: number;
};

export type HistoryStack<T> = {
  past: T[];
  present: T;
  future: T[];
};
