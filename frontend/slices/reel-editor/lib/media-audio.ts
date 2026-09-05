// Audio sub-graph for the media cache. Owns the WebAudio graph shared by preview
// MONITORING and export CAPTURE, plus the per-clip gain/fade/duck envelope. Kept
// separate from MediaCache so the element-pool and the audio-routing concerns
// stay small. No React — the owning MediaCache hands it element loaders.

import type { Clip, Composition, MediaType } from "./mock-timeline";

/** Per-clip audio envelope at clip-local frame `l`: gain × fade-in × fade-out. */
export function clipEnvelope(c: Clip, l: number): number {
  const vol = c.mute ? 0 : c.vol ?? 1;
  const fi = c.fadeIn ?? 0;
  const fo = c.fadeOut ?? 0;
  const gin = fi > 0 ? Math.min(1, l / fi) : 1;
  const gout = fo > 0 ? Math.min(1, (c.len - l) / fo) : 1;
  return Math.max(0, vol * Math.min(gin, gout));
}

/** Clips whose audio must be mixed into an export (video may carry audio). */
export const audioBearing = (c: { kind?: string; media?: { type: MediaType } }) =>
  c.media && (c.media.type === "audio" || c.media.type === "video");

const DUCK_LEVEL = 0.28; // ~-11 dB while another audio clip plays

type ElementLoaders = {
  loadAudio: (url: string) => HTMLAudioElement;
  loadVideo: (url: string) => HTMLVideoElement;
};

// Lazily-built audio graph, shared by preview MONITORING and export CAPTURE.
// Streaming MediaElementSource nodes (one per url, created once — the API
// forbids re-creating) feed a master gain that fans out to two taps:
//   master → monitorGain → ctx.destination   (speakers; 0 when monitor off)
//   master → captureGain → MediaStreamDest    (recorder; always on)
// Routing through the graph (never the element's default output) means monitor
// keeps working after an export. No PCM is held in JS, so RAM stays flat.
export class AudioGraph {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private sources = new Map<string, MediaElementAudioSourceNode>();
  private clipGains = new Map<string, GainNode>();
  private monitorVol = 1;

  constructor(private load: ElementLoaders) {}

  /** Audio-context clock, for smoothing per-clip gain changes. Null until built. */
  now(): number | null {
    return this.ctx ? this.ctx.currentTime : null;
  }

  /** Per-clip volume node (created by prepareSound). */
  clipGain(url: string): GainNode | undefined {
    return this.clipGains.get(url);
  }

  private ensureGraph(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.monitorGain = this.ctx.createGain();
      this.monitorGain.gain.value = this.monitorVol;
      this.dest = this.ctx.createMediaStreamDestination();
      const capture = this.ctx.createGain();
      this.master.connect(this.monitorGain).connect(this.ctx.destination); // speakers
      this.master.connect(capture).connect(this.dest); // recorder
    }
    return { ctx: this.ctx, master: this.master! };
  }

  /** Idempotent: ensure a streaming source exists + is unmuted for every
   *  audio-bearing clip, and the context is running. Cheap after the first call. */
  prepareSound(comp: Composition) {
    const clips = comp.clips.filter(audioBearing);
    if (!clips.length) return;
    const { ctx, master } = this.ensureGraph();
    if (ctx.state !== "running") void ctx.resume();
    for (const c of clips) {
      const m = c.media!;
      if (this.sources.has(m.url)) continue;
      const el = m.type === "audio" ? this.load.loadAudio(m.url) : this.load.loadVideo(m.url);
      el.muted = false; // source node redirects off speakers; graph controls audibility
      const src = ctx.createMediaElementSource(el);
      const gain = ctx.createGain(); // per-clip volume/fade lives here
      src.connect(gain).connect(master);
      this.sources.set(m.url, src);
      this.clipGains.set(m.url, gain);
    }
  }

  /** Drive the per-clip gain envelope for the playhead frame. `active` clips get
   *  their fade/duck envelope; everything else fades to 0. Smoothed so changes
   *  never click. No-op until the graph (and the clip's gain) exists. */
  applyEnvelope(comp: Composition, c: Clip, frame: number, active: boolean, reverse: boolean) {
    const g = this.clipGains.get(c.media!.url);
    if (!g || !this.ctx) return;
    const trackMuted = !!comp.tracks.find((t) => t.id === c.track)?.mute;
    let target = active && !reverse && !trackMuted ? clipEnvelope(c, frame - c.start) : 0;
    if (target > 0 && c.duck && this.otherAudioActive(comp, frame, c.id))
      target *= Math.min(1, Math.max(0, c.duckAmount ?? DUCK_LEVEL));
    g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
  }

  /** Is another (non-ducking) audio-bearing clip playing at `frame`? Drives ducking. */
  private otherAudioActive(comp: Composition, frame: number, selfId: string): boolean {
    return comp.clips.some(
      (x) => audioBearing(x) && !x.duck && x.id !== selfId && frame >= x.start && frame < x.start + x.len,
    );
  }

  /** Monitor (speaker) volume — 0 mutes preview without touching the capture tap. */
  setMonitor(on: boolean) {
    this.monitorVol = on ? 1 : 0;
    if (this.monitorGain) this.monitorGain.gain.value = this.monitorVol;
  }

  /** Wire the mix and return the recorder audio track(s). [] when comp has no audio. */
  beginExport(comp: Composition): MediaStreamTrack[] {
    if (!comp.clips.some(audioBearing)) return [];
    this.prepareSound(comp);
    return this.dest!.stream.getAudioTracks();
  }

  dispose() {
    this.sources.clear();
    this.clipGains.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
    this.monitorGain = null;
    this.dest = null;
  }
}
