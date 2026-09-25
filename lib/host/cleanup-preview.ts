import { randomUUID } from "node:crypto";
import type { CleanupItem } from "./cleanup";

const TTL_MS = 5 * 60_000;
const previews = new Map<string, { expiresAt: number; ids: Set<string> }>();
export function issueCleanupPreview(items: CleanupItem[], now = Date.now()) {
  for (const [key, value] of previews) if (value.expiresAt <= now) previews.delete(key);
  if (previews.size >= 128) previews.delete(previews.keys().next().value!);
  const id = randomUUID(), expiresAt = now + TTL_MS;
  previews.set(id, { expiresAt, ids: new Set(items.filter((item) => item.available).map((item) => item.id)) });
  return { id, expiresAt: new Date(expiresAt).toISOString() };
}

/** A fresh server preview + explicit choice is required, not a blanket delete. */
export function consumeCleanupPreview(id: unknown, ids: string[], confirm: unknown, now = Date.now()): void {
  if (confirm !== true || typeof id !== "string") throw new Error("preview and explicit confirmation required");
  const preview = previews.get(id);
  if (!preview || preview.expiresAt <= now) throw new Error("cleanup preview expired; rescan first");
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((item) => !preview.ids.has(item))) {
    throw new Error("cleanup selection is not available in this preview");
  }
  previews.delete(id);
}
