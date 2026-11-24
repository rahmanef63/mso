import {
  effectiveClipDuration,
  getAspectPreset,
  totalTimelineDuration,
  type ActiveTimelineClip,
  type HistoryStack,
  type ReelCaption,
  type ReelProjectState,
  type ReelTimelineClip,
} from "./reel-model.ts";

const TRANSITION_WINDOW_SEC = 0.6;
const HISTORY_LIMIT = 40;

export function resolveTimelineClipAtTime(
  clips: readonly ReelTimelineClip[],
  timeSec: number,
): ActiveTimelineClip | null {
  if (clips.length === 0) return null;
  const clamped = Number.isFinite(timeSec) && timeSec > 0 ? timeSec : 0;
  let cursor = 0;
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i]!;
    const durationSec = effectiveClipDuration(clip);
    const endSec = Math.round((cursor + durationSec) * 10) / 10;
    if (clamped < endSec || i === clips.length - 1) {
      const offsetSec = Math.min(durationSec, Math.max(0, Math.round((clamped - cursor) * 10) / 10));
      const win = Math.min(TRANSITION_WINDOW_SEC, durationSec * 0.45);
      const inTransition = i > 0 && clip.transition !== "cut" && win > 0 && offsetSec < win;
      const transitionProgress = inTransition ? Math.min(1, Math.max(0, offsetSec / win)) : 1;
      return {
        clip,
        index: i,
        startSec: cursor,
        endSec,
        offsetSec,
        durationSec,
        inTransition,
        transitionProgress,
      };
    }
    cursor = endSec;
  }
  return null;
}

export function resolveActiveCaptions(
  captions: readonly ReelCaption[],
  timeSec: number,
): ReelCaption[] {
  const t = Number.isFinite(timeSec) && timeSec >= 0 ? timeSec : 0;
  return captions.filter((cap) => t >= cap.startSec && t < cap.endSec);
}

export function clipStartTime(clips: readonly ReelTimelineClip[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < clips.length; i += 1) {
    acc += effectiveClipDuration(clips[i]!);
  }
  return Math.round(acc * 10) / 10;
}

export function splitClipAtTime(
  clips: readonly ReelTimelineClip[],
  clipId: string,
  playheadSec: number,
): { clips: ReelTimelineClip[]; createdId: string | null } {
  const index = clips.findIndex((c) => c.id === clipId);
  if (index < 0) return { clips: [...clips], createdId: null };
  const target = clips[index]!;
  const eff = effectiveClipDuration(target);
  if (eff < 1) return { clips: [...clips], createdId: null };
  const start = clipStartTime(clips, index);
  const rel = playheadSec - start;
  const splitOffset = rel >= 0.5 && rel <= eff - 0.5 ? Math.round(rel * 10) / 10 : Math.round((eff / 2) * 10) / 10;
  const firstDur = Math.max(0.5, splitOffset);
  const secondDur = Math.max(0.5, Math.round((eff - firstDur) * 10) / 10);
  const partA: ReelTimelineClip = {
    ...target,
    durationSec: firstDur,
    trimInSec: 0,
    trimOutSec: 0,
  };
  const createdId = `${target.id}-split-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const partB: ReelTimelineClip = {
    ...target,
    id: createdId,
    title: `${target.title} (Part 2)`,
    durationSec: secondDur,
    trimInSec: 0,
    trimOutSec: 0,
    transition: "cut",
  };
  const next = [...clips];
  next.splice(index, 1, partA, partB);
  return { clips: next, createdId };
}

export function duplicateClip(
  clips: readonly ReelTimelineClip[],
  clipId: string,
): { clips: ReelTimelineClip[]; createdId: string | null } {
  const index = clips.findIndex((c) => c.id === clipId);
  if (index < 0) return { clips: [...clips], createdId: null };
  const src = clips[index]!;
  const createdId = `${src.id}-copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
  const copy: ReelTimelineClip = {
    ...src,
    id: createdId,
    title: `${src.title} Copy`,
  };
  const next = [...clips];
  next.splice(index + 1, 0, copy);
  return { clips: next, createdId };
}

export function patchClipTrim(
  clip: ReelTimelineClip,
  trimInSec: number,
  trimOutSec: number,
): ReelTimelineClip {
  const maxTrim = Math.max(0, clip.durationSec - 0.5);
  const safeIn = Math.min(maxTrim, Math.max(0, Math.round(trimInSec * 10) / 10));
  const safeOut = Math.min(Math.max(0, maxTrim - safeIn), Math.max(0, Math.round(trimOutSec * 10) / 10));
  return { ...clip, trimInSec: safeIn, trimOutSec: safeOut };
}

export function createHistory<T>(initial: T): HistoryStack<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(stack: HistoryStack<T>, next: T): HistoryStack<T> {
  const past = [...stack.past, stack.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undoHistory<T>(stack: HistoryStack<T>): HistoryStack<T> {
  if (stack.past.length === 0) return stack;
  const previous = stack.past[stack.past.length - 1]!;
  return {
    past: stack.past.slice(0, -1),
    present: previous,
    future: [stack.present, ...stack.future].slice(0, HISTORY_LIMIT),
  };
}

export function redoHistory<T>(stack: HistoryStack<T>): HistoryStack<T> {
  if (stack.future.length === 0) return stack;
  const next = stack.future[0]!;
  return {
    past: [...stack.past, stack.present].slice(-HISTORY_LIMIT),
    present: next,
    future: stack.future.slice(1),
  };
}

export function buildStoryboardExport(project: ReelProjectState) {
  const aspect = getAspectPreset(project.aspect);
  const totalSec = totalTimelineDuration(project.clips);
  let cursor = 0;
  const timeline = project.clips.map((clip, index) => {
    const durationSec = effectiveClipDuration(clip);
    const startSec = Math.round(cursor * 10) / 10;
    cursor += durationSec;
    return {
      index,
      id: clip.id,
      title: clip.title,
      path: clip.path,
      startSec,
      durationSec,
      rawDurationSec: clip.durationSec,
      trimInSec: clip.trimInSec,
      trimOutSec: clip.trimOutSec,
      fit: clip.fit,
      filter: clip.filter,
      transition: clip.transition,
      caption: clip.caption,
    };
  });
  return {
    schema: "mso.reel.storyboard.v1",
    exportedAt: new Date().toISOString(),
    project: {
      title: project.title,
      aspect: project.aspect,
      width: aspect.width,
      height: aspect.height,
      fps: project.fps,
      totalDurationSec: totalSec,
    },
    tracks: {
      video: timeline,
      captions: project.captions,
      audio: project.audio,
    },
  };
}
