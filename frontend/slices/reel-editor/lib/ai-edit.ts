// Local heuristic that maps a natural-language phrase to a timeline action.
// No network. Returns a reply plus an optional Composition transform; some
// phrases need a selected clip (`needsClip`).

import { type Clip, type Composition } from "./mock-timeline";
import {
  duplicateClip,
  removeClip,
  setKeyTrack,
  setRatio,
  splitAt,
  addTextClip,
} from "./composition";

export type AiResult = {
  reply: string;
  /** Composition transform to apply, if any. */
  transform?: (c: Composition) => Composition;
  /** True when the phrase acted on the selected clip. */
  usedSelection?: boolean;
};

export const AI_SUGGESTIONS = ["Make it vertical", "Fade in", "Punch in", "Split here", "Spin", "Add title Sale"];

const NEEDS_CLIP = "Select a clip first, then ask again.";

export function interpretAi(text: string, frame: number, sel: Clip | null): AiResult {
  const t = text.toLowerCase();
  const needClip = (build: (c: Composition) => Composition, reply: string): AiResult =>
    sel ? { reply, transform: build, usedSelection: true } : { reply: NEEDS_CLIP };

  if (/vertical|9:16|tiktok|reel|story/.test(t))
    return { reply: "Switched to 9:16 vertical. Perfect for TikTok/Reels.", transform: (c) => setRatio(c, 1080, 1920) };
  if (/square|1:1/.test(t)) return { reply: "Switched to 1:1 square.", transform: (c) => setRatio(c, 1080, 1080) };
  if (/4:5|portrait/.test(t)) return { reply: "Switched to 4:5 portrait.", transform: (c) => setRatio(c, 1080, 1350) };
  if (/wide|16:9|landscape|youtube/.test(t))
    return { reply: "Switched to 16:9 landscape.", transform: (c) => setRatio(c, 1920, 1080) };
  if (/split|cut|razor/.test(t))
    return { reply: "Done: split at the playhead.", transform: (c) => splitAt(c, frame, sel?.id ?? null) };
  if (/duplicate|copy/.test(t))
    return needClip((c) => duplicateClip(c, sel!.id), "Duplicated the selected clip.");
  if (/delete|remove|trim out/.test(t))
    return needClip((c) => removeClip(c, sel!.id), "Deleted the clip.");
  if (/fade in/.test(t))
    return needClip((c) => setKeyTrack(c, sel!.id, "opacity", [{ t: 0, v: 0 }, { t: 12, v: 100 }]), "Added a fade-in.");
  if (/fade out/.test(t))
    return needClip(
      (c) => setKeyTrack(c, sel!.id, "opacity", [{ t: Math.max(0, sel!.len - 12), v: 100 }, { t: sel!.len, v: 0 }]),
      "Added a fade-out.",
    );
  if (/punch|zoom in|ken ?burns|scale up/.test(t))
    return needClip((c) => setKeyTrack(c, sel!.id, "scale", [{ t: 0, v: 100 }, { t: sel!.len, v: 118 }]), "Added a slow punch-in zoom.");
  if (/spin|rotate/.test(t))
    return needClip((c) => setKeyTrack(c, sel!.id, "rotate", [{ t: 0, v: 0 }, { t: sel!.len, v: 360 }]), "Added a 360° spin.");
  if (/slide in|slide/.test(t))
    return needClip((c) => setKeyTrack(c, sel!.id, "x", [{ t: 0, v: -60 }, { t: 14, v: 0 }]), "Added a slide-in from the left.");

  const m = text.match(/(?:title|text|caption)\s+(.+)/i);
  if (m) return { reply: `Added title “${m[1]}”.`, transform: (c) => addTextClip(c, m[1], frame) };

  if (/help|what can/.test(t))
    return {
      reply:
        "I can: vertical / square / 4:5 / 16:9, split, duplicate, delete, fade in, fade out, punch in, spin, slide in, add title <text>.",
    };
  return { reply: "Not sure yet. Try “vertical”, “fade in”, “split”, “punch in”, “spin”, or “add title …”." };
}
