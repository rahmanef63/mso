import { describe, it, expect } from "vitest";
import {
  clampTrim,
  setSpeed,
  splitAt,
  setCrossfade,
  isXfadeSource,
  moveTrack,
} from "./composition";
import { type Composition, type Clip, type Track } from "./mock-timeline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTrack(id: string, kind: Track["kind"] = "video"): Track {
  return { id, name: id, kind };
}

function mkClip(overrides: Partial<Clip> & Pick<Clip, "id" | "track" | "start" | "len">): Clip {
  return {
    name: overrides.id,
    color: "#fff",
    kind: "video",
    ...overrides,
  } as Clip;
}

function mkComp(clips: Clip[], tracks: Track[] = []): Composition {
  return { w: 1920, h: 1080, fps: 30, duration: 300, tracks, clips };
}

// ---------------------------------------------------------------------------
// clampTrim
// ---------------------------------------------------------------------------

describe("clampTrim", () => {
  it("dur=undefined → no upper cap, srcIn floored at 0", () => {
    const r = clampTrim(undefined, 30, 0, 60);
    expect(r).toEqual({ srcIn: 0, len: 60 });
  });

  it("dur=undefined, negative srcIn is clamped to 0", () => {
    const r = clampTrim(undefined, 30, -5, 60);
    expect(r.srcIn).toBe(0);
  });

  it("dur=undefined, len below min is raised to 6", () => {
    const r = clampTrim(undefined, 30, 0, 3);
    expect(r.len).toBe(6);
  });

  it("dur defined → srcIn clamped to [0, dur]", () => {
    expect(clampTrim(10, 30, -1, 60).srcIn).toBe(0);
    expect(clampTrim(10, 30, 15, 60).srcIn).toBe(10); // capped at dur
    expect(clampTrim(10, 30, 5, 60).srcIn).toBe(5);
  });

  it("dur defined → len capped by remaining source frames", () => {
    // dur=10s, fps=30, srcIn=4s → remaining 6s → 180 frames at speed 1
    const r = clampTrim(10, 30, 4, 300);
    expect(r.len).toBe(180);
  });

  it("speed scaling: faster speed → fewer timeline frames for same source window", () => {
    // dur=10s, fps=30, srcIn=0, speed=2 → 10s of source / 2 = 5s wall time = 150 frames
    const r = clampTrim(10, 30, 0, 999, 2);
    expect(r.len).toBe(150);
  });

  it("speed scaling: slower speed → more timeline frames", () => {
    // dur=10s, fps=30, srcIn=0, speed=0.5 → 10s*2 = 20s = 600 frames
    const r = clampTrim(10, 30, 0, 999, 0.5);
    expect(r.len).toBe(600);
  });

  it("len is raised to min 6 even when source cap would be smaller", () => {
    // dur=0.1s, fps=30, srcIn=0 → max = round(0.1*30/1)=3 < 6 → clamped to 6
    const r = clampTrim(0.1, 30, 0, 60);
    expect(r.len).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// setSpeed
// ---------------------------------------------------------------------------

describe("setSpeed", () => {
  const clip = mkClip({ id: "c1", track: "t1", start: 0, len: 60 });
  const comp = mkComp([clip]);

  it("clamps speed below 0.25 to 0.25 and rescales len", () => {
    const r = setSpeed(comp, "c1", 0.1);
    const found = r.clips.find((c) => c.id === "c1")!;
    expect(found.speed).toBe(0.25);
    // len = round(60 * 1 / 0.25) = 240
    expect(found.len).toBe(240);
  });

  it("clamps speed above 4 to 4 and rescales len", () => {
    const r = setSpeed(comp, "c1", 10);
    const found = r.clips.find((c) => c.id === "c1")!;
    expect(found.speed).toBe(4);
    // len = round(60 * 1 / 4) = 15
    expect(found.len).toBe(15);
  });

  it("speed=1 leaves len unchanged", () => {
    const r = setSpeed(comp, "c1", 1);
    expect(r.clips.find((c) => c.id === "c1")!.len).toBe(60);
  });

  it("speed=2 halves the timeline len (same source window)", () => {
    const r = setSpeed(comp, "c1", 2);
    expect(r.clips.find((c) => c.id === "c1")!.len).toBe(30);
  });

  it("unknown clipId returns comp unchanged", () => {
    const r = setSpeed(comp, "nonexistent", 2);
    expect(r).toBe(comp);
  });
});

// ---------------------------------------------------------------------------
// splitAt
// ---------------------------------------------------------------------------

describe("splitAt", () => {
  const clip = mkClip({ id: "c1", track: "t1", start: 0, len: 60 });
  const other = mkClip({ id: "c2", track: "t1", start: 100, len: 50 });
  const comp = mkComp([clip, other]);

  it("splitting outside target clip leaves clips unchanged", () => {
    const r = splitAt(comp, 80, null);
    expect(r.clips).toHaveLength(2);
  });

  it("splitting within produces two clips with correct start/len", () => {
    const r = splitAt(comp, 30, "c1");
    expect(r.clips).toHaveLength(3);
    // left part: start=0, len=30
    const left = r.clips.find((c) => c.id === "c1")!;
    expect(left.start).toBe(0);
    expect(left.len).toBe(30);
    // right part: start=30
    const right = r.clips.find((c) => c.id !== "c1" && c.id !== "c2")!;
    expect(right.start).toBe(30);
    expect(right.len).toBe(30);
  });

  it("selId=null picks the clip the frame falls within (no explicit selection)", () => {
    const r = splitAt(comp, 20, null);
    expect(r.clips.length).toBe(3); // c1 was split
  });

  it("selId pointing to a clip that does not contain the frame → no split", () => {
    // frame 10 is inside c1 (0..60) but selId=c2 (100..150)
    const r = splitAt(comp, 10, "c2");
    expect(r.clips).toHaveLength(2);
  });

  it("distributes keyframes: left gets t<=split, right gets remapped t>=0", () => {
    const clipKf = mkClip({
      id: "c-kf",
      track: "t1",
      start: 0,
      len: 60,
      kf: { opacity: [{ t: 0, v: 0 }, { t: 20, v: 100 }, { t: 40, v: 50 }] },
    });
    const r = splitAt(mkComp([clipKf]), 30, "c-kf");
    const left = r.clips.find((c) => c.id === "c-kf")!;
    const right = r.clips.find((c) => c.id !== "c-kf")!;
    // left: t<=30 → t=0,20
    expect(left.kf?.opacity?.map((k) => k.t)).toEqual([0, 20]);
    // right: remap → t-30, keep t>=0: t=40-30=10
    expect(right.kf?.opacity?.map((k) => k.t)).toEqual([10]);
  });
});

// ---------------------------------------------------------------------------
// setCrossfade
// ---------------------------------------------------------------------------

describe("setCrossfade", () => {
  const prev = mkClip({ id: "prev", track: "t1", start: 0, len: 60 });
  const curr = mkClip({ id: "curr", track: "t1", start: 60, len: 60 });
  const comp = mkComp([prev, curr]);

  it("no prev clip on track → returns comp unchanged", () => {
    const solo = mkComp([mkClip({ id: "solo", track: "t1", start: 0, len: 60 })]);
    const r = setCrossfade(solo, "solo", 10);
    expect(r).toBe(solo);
  });

  it("valid frames: overlap computed, start pulled left", () => {
    const r = setCrossfade(comp, "curr", 10);
    const c = r.clips.find((cl) => cl.id === "curr")!;
    expect(c.xfade).toBe(10);
    // start = prev.start + prev.len - f = 0 + 60 - 10 = 50
    expect(c.start).toBe(50);
  });

  it("frames=0 clears xfade and resets start to prev tail", () => {
    // first set a crossfade, then clear it
    const r1 = setCrossfade(comp, "curr", 10);
    const r2 = setCrossfade(r1, "curr", 0);
    const c = r2.clips.find((cl) => cl.id === "curr")!;
    expect(c.xfade).toBeUndefined();
    expect(c.start).toBe(60); // prev.start + prev.len
  });

  it("clamped to min(prev.len-1, curr.len-1)", () => {
    // request 100 frames, both clips are 60 → clamped to 59
    const r = setCrossfade(comp, "curr", 100);
    const c = r.clips.find((cl) => cl.id === "curr")!;
    expect(c.xfade).toBe(59);
  });
});

// ---------------------------------------------------------------------------
// isXfadeSource
// ---------------------------------------------------------------------------

describe("isXfadeSource", () => {
  it("returns true when a later clip dissolves in over clip tail", () => {
    const a = mkClip({ id: "a", track: "t1", start: 0, len: 60 });
    const b = mkClip({ id: "b", track: "t1", start: 50, len: 60, xfade: 10 } as Clip);
    const comp = mkComp([a, b]);
    expect(isXfadeSource(comp, a)).toBe(true);
  });

  it("returns false for a clip with no xfade successor", () => {
    const a = mkClip({ id: "a", track: "t1", start: 0, len: 60 });
    const comp = mkComp([a]);
    expect(isXfadeSource(comp, a)).toBe(false);
  });

  it("returns false when the dissolving clip is on a different track", () => {
    const a = mkClip({ id: "a", track: "t1", start: 0, len: 60 });
    const b = mkClip({ id: "b", track: "t2", start: 50, len: 60, xfade: 10 } as Clip);
    expect(isXfadeSource(mkComp([a, b]), a)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveTrack
// ---------------------------------------------------------------------------

describe("moveTrack", () => {
  const t1 = mkTrack("t1");
  const t2 = mkTrack("t2");
  const t3 = mkTrack("t3");
  const comp = mkComp([], [t1, t2, t3]);

  it("dir=-1 moves track one step up (towards index 0)", () => {
    const r = moveTrack(comp, "t2", -1);
    expect(r.tracks.map((t) => t.id)).toEqual(["t2", "t1", "t3"]);
  });

  it("dir=+1 moves track one step down", () => {
    const r = moveTrack(comp, "t2", 1);
    expect(r.tracks.map((t) => t.id)).toEqual(["t1", "t3", "t2"]);
  });

  it("dir=-1 on the first track is a noop (boundary clamp)", () => {
    const r = moveTrack(comp, "t1", -1);
    expect(r).toBe(comp);
  });

  it("dir=+1 on the last track is a noop (boundary clamp)", () => {
    const r = moveTrack(comp, "t3", 1);
    expect(r).toBe(comp);
  });

  it("unknown id is a noop", () => {
    const r = moveTrack(comp, "nope", 1);
    expect(r).toBe(comp);
  });
});
