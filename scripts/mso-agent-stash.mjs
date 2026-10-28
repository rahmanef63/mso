// Stash prompt buffer kept strictly in memory for the active TUI process.
// Not persisted across runs because uncommitted scratch input is ephemeral.

const MAX_STASH = 20;

function getEntries(stash) {
  if (Array.isArray(stash)) return stash;
  if (stash && Array.isArray(stash.items)) return stash.items;
  return null;
}

export function createStash() {
  return { items: [] };
}

export function stashPush(stash, text) {
  const items = getEntries(stash);
  if (!items) return { ok: false, error: "invalid stash" };
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { ok: false, empty: true, count: items.length };
  }
  if (items.length >= MAX_STASH) {
    return {
      ok: false,
      capped: true,
      cap: MAX_STASH,
      count: items.length,
      error: `stash full (cap is ${MAX_STASH} items)`,
    };
  }
  items.push(trimmed);
  return { ok: true, count: items.length, item: trimmed };
}

export function stashPop(stash) {
  const items = getEntries(stash);
  if (!items || !items.length) return null;
  return items.pop() ?? null;
}

export function stashList(stash) {
  const items = getEntries(stash);
  if (!items) return [];
  // Return newest-first view of stashed prompts.
  return [...items].reverse();
}

export function stashClear(stash) {
  const items = getEntries(stash);
  if (!items) return 0;
  const dropped = items.length;
  items.length = 0;
  return dropped;
}
