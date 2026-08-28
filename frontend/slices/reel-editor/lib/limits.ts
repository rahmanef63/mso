import type { Composition } from "./mock-timeline";

export const REEL_LIMITS = {
  maxCanvasDimension: 4096,
  maxCanvasPixels: 16_777_216,
  minFps: 1,
  maxFps: 120,
  maxDurationSeconds: 60 * 60,
  maxWaveformBytes: 8 * 1024 * 1024,
  maxWaveformSeconds: 10 * 60,
  maxWaveformSampleValues: 24_000_000,
  maxWaveformChannels: 2,
} as const;

export function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function compositionBoundsError(comp: Pick<Composition, "w" | "h" | "fps" | "duration">): string | null {
  const { w, h, fps, duration } = comp;
  if (![w, h, fps, duration].every(Number.isFinite)) return "composition dimensions, FPS and duration must be finite";
  if (![w, h, fps, duration].every(Number.isSafeInteger)) return "composition dimensions, FPS and duration must be safe integers";
  if (w < 1 || h < 1 || w > REEL_LIMITS.maxCanvasDimension || h > REEL_LIMITS.maxCanvasDimension) {
    return `composition dimensions must be 1–${REEL_LIMITS.maxCanvasDimension}px`;
  }
  if (w * h > REEL_LIMITS.maxCanvasPixels) return "composition canvas exceeds the pixel budget";
  if (fps < REEL_LIMITS.minFps || fps > REEL_LIMITS.maxFps) return `composition FPS must be ${REEL_LIMITS.minFps}–${REEL_LIMITS.maxFps}`;
  if (duration < 1 || duration / fps > REEL_LIMITS.maxDurationSeconds) return "composition duration exceeds the one-hour render budget";
  return null;
}

export function assertCompositionBounds(comp: Pick<Composition, "w" | "h" | "fps" | "duration">): void {
  const error = compositionBoundsError(comp);
  if (error) throw new Error(error);
}
