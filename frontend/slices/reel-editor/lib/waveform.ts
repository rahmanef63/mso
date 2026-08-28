"use client";

// Real waveform peaks for audio clips. Decodes a source ONCE, reduces it to a
// tiny normalized peak array (BUCKETS bytes), then drops the AudioBuffer so only
// the summary survives — RAM stays flat no matter how long the track is. A
// stride scan bounds CPU on long files. One shared decode context, module-cached.

import { useEffect, useState } from "react";
import { REEL_LIMITS } from "./limits";

const BUCKETS = 160;
const MAX_CACHE_ENTRIES = 128;
const peaks = new Map<string, Uint8Array>();
const pending = new Map<string, Promise<Uint8Array | null>>();
let ctx: AudioContext | null = null;


export async function readBoundedAudioBytes(response: Response): Promise<ArrayBuffer> {
  if (!response.ok) throw new Error(`waveform source HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > REEL_LIMITS.maxWaveformBytes) {
    throw new Error("waveform source exceeds byte limit");
  }
  if (!response.body) {
    const data = await response.arrayBuffer();
    if (data.byteLength > REEL_LIMITS.maxWaveformBytes) throw new Error("waveform source exceeds byte limit");
    return data;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > REEL_LIMITS.maxWaveformBytes) {
        await reader.cancel("waveform source exceeds byte limit").catch(() => {});
        throw new Error("waveform source exceeds byte limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out.buffer;
}

export function waveformWithinDecodeBudget(audio: Pick<AudioBuffer, "duration" | "numberOfChannels" | "length">): boolean {
  return Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration <= REEL_LIMITS.maxWaveformSeconds &&
    Number.isSafeInteger(audio.numberOfChannels) && audio.numberOfChannels >= 1 && audio.numberOfChannels <= REEL_LIMITS.maxWaveformChannels &&
    Number.isSafeInteger(audio.length) && audio.length > 0 && audio.length * audio.numberOfChannels <= REEL_LIMITS.maxWaveformSampleValues;
}

function rememberPeaks(url: string, value: Uint8Array) {
  peaks.delete(url);
  peaks.set(url, value);
  while (peaks.size > MAX_CACHE_ENTRIES) peaks.delete(peaks.keys().next().value!);
}

function decodeCtx(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

export function computePeaks(url: string): Promise<Uint8Array | null> {
  const hit = peaks.get(url);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const job = (async () => {
    try {
      const response = await fetch(url);
      const buf = await readBoundedAudioBytes(response);
      const audio = await decodeCtx().decodeAudioData(buf);
      if (!waveformWithinDecodeBudget(audio)) return null;
      const ch = audio.getChannelData(0);
      const n = ch.length;
      const block = Math.max(1, Math.floor(n / BUCKETS));
      const out = new Uint8Array(BUCKETS);
      for (let b = 0; b < BUCKETS; b++) {
        const start = b * block;
        const end = Math.min(n, start + block);
        const stride = Math.max(1, Math.floor((end - start) / 512));
        let peak = 0;
        for (let i = start; i < end; i += stride) {
          const a = Math.abs(ch[i]);
          if (a > peak) peak = a;
        }
        out[b] = Math.min(255, Math.round(peak * 255));
      }
      rememberPeaks(url, out); // `audio` AudioBuffer now unreferenced → GC'd
      return out;
    } catch {
      return null;
    } finally {
      pending.delete(url);
    }
  })();
  pending.set(url, job);
  return job;
}

/** Peaks for a clip's audio url, computed lazily; null while loading / on error. */
export function useWaveform(url: string | undefined): Uint8Array | null {
  // The module-level `peaks` map is the source of truth — render derives from
  // it directly; state only marks "url X finished" to trigger the re-render
  // (no synchronous setState in the effect, react-hooks/set-state-in-effect).
  const [, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!url || peaks.get(url)) return;
    let alive = true;
    void computePeaks(url).then(() => alive && setDone(url));
    return () => void (alive = false);
  }, [url]);
  return url ? (peaks.get(url) ?? null) : null;
}
