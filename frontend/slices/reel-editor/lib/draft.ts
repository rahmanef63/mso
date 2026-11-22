// Project draft persistence (auto-save). One draft per browser, stored in
// localStorage. NB upload clips use blob: object-URLs which die with the page —
// they survive in the draft's data but won't decode after a reload; VPS/sample
// media restores fully.

import { type Composition } from "./mock-timeline";
import { compositionBoundsError } from "./limits";

const KEY = "reel.draft";

export function readDraft(): { comp: Composition | null; snapshot: string | null; available: boolean } {
  if (typeof window === "undefined") return { comp: null, snapshot: null, available: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { comp: null, snapshot: raw, available: true };
    const c = JSON.parse(raw) as Composition;
    if (!c || !Array.isArray(c.tracks) || !Array.isArray(c.clips) || compositionBoundsError(c)) return { comp: null, snapshot: raw, available: true };
    return { comp: migrateLayerOrder(c), snapshot: raw, available: true };
  } catch {
    return { comp: null, snapshot: null, available: false };
  }
}

export function loadDraft(): Composition | null { return readDraft().comp; }

// Drafts saved before tracks became layers used the old default order
// [video, overlay, text, audio] with start-time z-ordering. Under the new
// top-row-is-front rule that order would paint video OVER text/logo, so flip
// the exact old default to the new one (custom orders are left alone).
function migrateLayerOrder(c: Composition): Composition {
  const kinds = c.tracks.map((t) => t.kind).join(",");
  if (kinds !== "video,overlay,text,audio") return c;
  const by = (k: string) => c.tracks.find((t) => t.kind === k)!;
  return { ...c, tracks: [by("text"), by("overlay"), by("video"), by("audio")] };
}

export function saveDraft(c: Composition): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
