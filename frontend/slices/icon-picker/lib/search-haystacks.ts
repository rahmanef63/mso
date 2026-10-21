import { ALL_EMOJIS } from "./emoji-catalog";
import { ALL_LUCIDE } from "./lucide-catalog";
import { ALL_PHOSPHOR } from "./phosphor-catalog";
import { buildEmojiSearchHaystack } from "./emoji-keywords";

/** Precomputed lowercase search haystacks. Built once at module load. */
export const EMOJI_HAYSTACKS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const e of ALL_EMOJIS) map.set(e, buildEmojiSearchHaystack(e));
  return map;
})();

export const LUCIDE_LOWER: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const n of ALL_LUCIDE) map.set(n, n.toLowerCase());
  return map;
})();

export const PHOSPHOR_LOWER: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const n of ALL_PHOSPHOR) map.set(n, n.toLowerCase());
  return map;
})();

export function filterEmoji(query: string): string[] | null {
  if (!query) return null;
  const out: string[] = [];
  for (const e of ALL_EMOJIS) {
    const hay = EMOJI_HAYSTACKS.get(e);
    if (hay && hay.includes(query)) out.push(e);
  }
  return out;
}

export function filterLucide(query: string): string[] | null {
  if (!query) return null;
  const out: string[] = [];
  for (const n of ALL_LUCIDE) {
    const hay = LUCIDE_LOWER.get(n);
    if (hay && hay.includes(query)) out.push(n);
  }
  return out;
}

export function filterPhosphor(query: string): string[] | null {
  if (!query) return null;
  const out: string[] = [];
  for (const n of ALL_PHOSPHOR) {
    const hay = PHOSPHOR_LOWER.get(n);
    if (hay && hay.includes(query)) out.push(n);
  }
  return out;
}
