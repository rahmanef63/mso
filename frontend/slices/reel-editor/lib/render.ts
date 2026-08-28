// Offline client-side renderer. Runs ONE real-time pass (driven by a
// performance.now clock) so the canvas AND the audio graph can be captured live
// by MediaRecorder into a single .webm with sound. Video/audio elements stream
// (no PCM in JS), so RAM stays flat regardless of clip length. The preview uses
// the SAME drawFrame() path, so the export matches what you see.

import type { Composition } from "./mock-timeline";
import { drawFrame } from "./draw";
import type { MediaCache } from "./media-cache";
import { assertCompositionBounds } from "./limits";

const VMIMES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm",
];

function pickMime(): string {
  const sup = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported;
  return (sup && VMIMES.find((m) => MediaRecorder.isTypeSupported(m))) || "video/webm";
}

// Wait until every media element backing the comp can be drawn/played (images
// decoded, video/audio past HAVE_CURRENT_DATA) — capped so a broken src can't hang.
function whenReady(comp: Composition, cache: MediaCache): Promise<void> {
  const jobs: Promise<void>[] = [];
  const waitEl = (el: HTMLMediaElement | null) => {
    if (el && el.readyState < 2)
      jobs.push(new Promise((res) => {
        el.addEventListener("loadeddata", () => res(), { once: true });
        setTimeout(res, 4000);
      }));
  };
  for (const c of comp.clips) {
    const m = c.media;
    if (!m) continue;
    if (m.type === "image") {
      const img = cache.image(m.url);
      if (img && !img.complete)
        jobs.push(new Promise((res) => { img.onload = () => res(); img.onerror = () => res(); }));
    } else if (m.type === "video") waitEl(cache.video(m.url));
    else waitEl(cache.audio(m.url));
  }
  return Promise.all(jobs).then(() => void 0);
}

export async function renderToWebM(
  comp: Composition,
  cache: MediaCache,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  assertCompositionBounds(comp);
  const canvas = document.createElement("canvas");
  canvas.width = comp.w;
  canvas.height = comp.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");

  cache.ensure(comp);
  cache.pauseAll();
  await whenReady(comp, cache);

  // Compose video (canvas) + mixed audio into one recorder stream.
  const audioTracks = cache.beginAudioExport(comp);
  const stream = new MediaStream([
    ...canvas.captureStream(comp.fps).getVideoTracks(),
    ...audioTracks,
  ]);
  const recorder = new MediaRecorder(stream, { mimeType: pickMime() });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

  const durSec = Math.max(0.001, comp.duration / comp.fps);

  await new Promise<void>((resolve) => {
    recorder.start();
    const t0 = performance.now();
    let raf = 0;
    const finish = () => {
      cancelAnimationFrame(raf);
      cache.endAudioExport();
      recorder.stop();
      resolve();
    };
    const tick = (now: number) => {
      if (signal?.aborted) return finish();
      const elapsed = (now - t0) / 1000;
      if (elapsed >= durSec) return finish();
      const f = elapsed * comp.fps;
      cache.syncPlayback(comp, f, true, true); // play active video + audio, captured
      drawFrame(ctx, comp, f, cache);
      onProgress((elapsed / durSec) * 100);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });

  await stopped;
  return new Blob(chunks, { type: recorder.mimeType || "video/webm" });
}
