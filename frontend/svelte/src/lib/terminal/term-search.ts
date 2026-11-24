// Scrollback search helpers. Case-insensitive, bounded so a huge buffer or a
// pathological query cannot stall the UI thread.
export type Match = { start: number; length: number };

export const MAX_MATCHES = 500;

export function findMatches(text: string, query: string, limit = MAX_MATCHES): Match[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return [];
  const haystack = text.toLowerCase();
  const matches: Match[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1 && matches.length < limit) {
    matches.push({ start: at, length: needle.length });
    at = haystack.indexOf(needle, at + Math.max(1, needle.length));
  }
  return matches;
}

/** Cycle through matches: `delta` of +1 / -1, wrapping at both ends. */
export function stepMatch(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  const next = (current + delta + total) % total;
  return next < 0 ? total - 1 : next;
}

export function matchLabel(index: number, total: number): string {
  if (total === 0) return "No matches";
  return `${Math.max(1, index + 1)} of ${total}`;
}
