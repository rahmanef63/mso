// Ephemeral in-memory queue: follow-up prompts are scoped to the active TUI process and never persisted to the server.

function getItems(queue) {
  if (Array.isArray(queue)) return queue;
  if (queue && Array.isArray(queue.items)) return queue.items;
  return null;
}

export function createQueue() {
  return { items: [] };
}

export function enqueue(queue, text) {
  const items = getItems(queue);
  if (!items) return { ok: false, error: "invalid queue" };
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { ok: false, empty: true, count: items.length };
  }
  if (items.length >= 20) {
    return { ok: false, capped: true, cap: 20, count: items.length, error: "queue full (cap is 20 items)" };
  }
  items.push(trimmed);
  return { ok: true, count: items.length, item: trimmed };
}

export function dequeue(queue) {
  const items = getItems(queue);
  if (!items || !items.length) return null;
  return items.shift() ?? null;
}

export function queueList(queue) {
  const items = getItems(queue);
  return items ? [...items] : [];
}

export function queueClear(queue) {
  const items = getItems(queue);
  if (!items) return 0;
  const dropped = items.length;
  items.length = 0;
  return dropped;
}
