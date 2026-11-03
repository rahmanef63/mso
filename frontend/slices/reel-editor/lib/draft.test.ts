import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Composition, Track } from "./mock-timeline";

// ─── localStorage stub (node environment, no jsdom) ─────────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};

// Stub window + localStorage before the module is imported
vi.stubGlobal("window", { localStorage: localStorageMock });
vi.stubGlobal("localStorage", localStorageMock);

// Import AFTER stubs are in place
const { loadDraft, saveDraft, clearDraft } = await import("./draft");

const KEY = "reel.draft";

function makeTrack(kind: Track["kind"], id?: string): Track {
  return { id: id ?? `t-${kind}`, name: kind, kind };
}

function baseComp(overrides: Partial<Composition> = {}): Composition {
  return {
    w: 1920,
    h: 1080,
    fps: 30,
    duration: 300,
    tracks: [makeTrack("text"), makeTrack("overlay"), makeTrack("video"), makeTrack("audio")],
    clips: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorageMock.clear();
});

// ─── loadDraft validation ────────────────────────────────────────────────────

describe("loadDraft — validation", () => {
  it("returns null when localStorage is empty", () => {
    expect(loadDraft()).toBeNull();
  });

  it("returns null when stored JSON is invalid", () => {
    localStorageMock.setItem(KEY, "not-json{{{");
    expect(loadDraft()).toBeNull();
  });

  it("returns null when c.w is missing/falsy", () => {
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ w: 0 })));
    expect(loadDraft()).toBeNull();
  });

  it("returns null when c.h is missing/falsy", () => {
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ h: 0 })));
    expect(loadDraft()).toBeNull();
  });

  it("returns null when c.fps is missing/falsy", () => {
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ fps: 0 })));
    expect(loadDraft()).toBeNull();
  });

  it("returns null when tracks is not an array", () => {
    const raw = { ...baseComp(), tracks: "oops" };
    localStorageMock.setItem(KEY, JSON.stringify(raw));
    expect(loadDraft()).toBeNull();
  });

  it("returns null when clips is not an array", () => {
    const raw = { ...baseComp(), clips: null };
    localStorageMock.setItem(KEY, JSON.stringify(raw));
    expect(loadDraft()).toBeNull();
  });

  it("returns null for a non-object stored value", () => {
    localStorageMock.setItem(KEY, JSON.stringify(42));
    expect(loadDraft()).toBeNull();
  });

  it("returns a valid composition (no migration needed, fields intact)", () => {
    const c = baseComp();
    localStorageMock.setItem(KEY, JSON.stringify(c));
    const result = loadDraft();
    expect(result).not.toBeNull();
    expect(result!.w).toBe(1920);
    expect(result!.fps).toBe(30);
  });
});

// ─── migrateLayerOrder via loadDraft ────────────────────────────────────────

describe("migrateLayerOrder — old default order → flipped", () => {
  it("flips video,overlay,text,audio to text,overlay,video,audio", () => {
    const oldOrder: Track[] = [
      makeTrack("video", "t-video"),
      makeTrack("overlay", "t-overlay"),
      makeTrack("text", "t-text"),
      makeTrack("audio", "t-audio"),
    ];
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ tracks: oldOrder })));

    const result = loadDraft();
    expect(result).not.toBeNull();
    expect(result!.tracks.map((t) => t.kind)).toEqual(["text", "overlay", "video", "audio"]);
  });

  it("preserves the original track objects (same ids) after migration", () => {
    const oldOrder: Track[] = [
      makeTrack("video", "id-video"),
      makeTrack("overlay", "id-overlay"),
      makeTrack("text", "id-text"),
      makeTrack("audio", "id-audio"),
    ];
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ tracks: oldOrder })));

    const result = loadDraft();
    expect(result!.tracks[0].id).toBe("id-text");
    expect(result!.tracks[1].id).toBe("id-overlay");
    expect(result!.tracks[2].id).toBe("id-video");
    expect(result!.tracks[3].id).toBe("id-audio");
  });

  it("does NOT mutate the rest of the composition during migration", () => {
    const oldOrder: Track[] = [
      makeTrack("video"), makeTrack("overlay"), makeTrack("text"), makeTrack("audio"),
    ];
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ tracks: oldOrder, duration: 999, w: 1280 })));

    const result = loadDraft();
    expect(result!.w).toBe(1280);
    expect(result!.duration).toBe(999);
    expect(result!.clips).toEqual([]);
  });
});

describe("migrateLayerOrder — custom orders are left alone", () => {
  it("does not reorder text,overlay,video,audio (already new default)", () => {
    const newDefault: Track[] = [
      makeTrack("text"), makeTrack("overlay"), makeTrack("video"), makeTrack("audio"),
    ];
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ tracks: newDefault })));

    const result = loadDraft();
    expect(result!.tracks.map((t) => t.kind)).toEqual(["text", "overlay", "video", "audio"]);
  });

  it("leaves a partial track list (missing tracks) untouched — no crash", () => {
    const partial: Track[] = [makeTrack("video"), makeTrack("audio")];
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ tracks: partial })));

    const result = loadDraft();
    expect(result).not.toBeNull();
    expect(result!.tracks.map((t) => t.kind)).toEqual(["video", "audio"]);
  });

  it("leaves a single-track composition untouched", () => {
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ tracks: [makeTrack("audio")] })));
    const result = loadDraft();
    expect(result!.tracks.map((t) => t.kind)).toEqual(["audio"]);
  });

  it("leaves a reordered non-default order untouched", () => {
    const custom: Track[] = [
      makeTrack("audio"), makeTrack("video"), makeTrack("text"), makeTrack("overlay"),
    ];
    localStorageMock.setItem(KEY, JSON.stringify(baseComp({ tracks: custom })));

    const result = loadDraft();
    expect(result!.tracks.map((t) => t.kind)).toEqual(["audio", "video", "text", "overlay"]);
  });
});

// ─── saveDraft / clearDraft ──────────────────────────────────────────────────

describe("saveDraft + loadDraft round-trip", () => {
  it("persists and reloads a composition identically", () => {
    const c = baseComp({ fps: 60, duration: 120 });
    saveDraft(c);
    const result = loadDraft();
    expect(result).not.toBeNull();
    expect(result!.fps).toBe(60);
    expect(result!.duration).toBe(120);
  });
});

describe("clearDraft", () => {
  it("removes the draft so loadDraft returns null afterward", () => {
    saveDraft(baseComp());
    expect(loadDraft()).not.toBeNull();
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
});

describe("saveDraft failure reporting", () => {
  it("reports storage failure without claiming success", () => {
    const fail = vi.spyOn(localStorageMock, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
    expect(saveDraft(baseComp())).toBe(false);
    fail.mockRestore();
    expect(saveDraft(baseComp())).toBe(true);
  });
});
