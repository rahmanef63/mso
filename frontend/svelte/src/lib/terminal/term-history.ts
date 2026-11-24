// Command history with shell-like arrow navigation. Newest entry is index 0.
export type History = { entries: string[]; cursor: number };

export const MAX_HISTORY = 100;

export function emptyHistory(): History {
  return { entries: [], cursor: -1 };
}

/** Blank or duplicate-of-newest commands are not recorded, matching shell habit. */
export function pushHistory(history: History, command: string): History {
  const text = command.trim();
  if (!text || text === history.entries[0]) return { ...history, cursor: -1 };
  return { entries: [text, ...history.entries].slice(0, MAX_HISTORY), cursor: -1 };
}

/** `delta` -1 walks toward older commands (Up), +1 toward newer (Down). */
export function stepHistory(history: History, delta: -1 | 1): { history: History; value: string } {
  const { entries, cursor } = history;
  if (!entries.length) return { history, value: "" };
  const last = entries.length - 1;
  if (delta === -1) {
    const next = Math.min(last, cursor + 1);
    return { history: { ...history, cursor: next }, value: entries[next] };
  }
  if (cursor <= 0) return { history: { ...history, cursor: -1 }, value: "" };
  const next = cursor - 1;
  return { history: { ...history, cursor: next }, value: entries[next] };
}
