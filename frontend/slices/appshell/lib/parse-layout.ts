import type { PersistedWindow, Rect, SnapZone } from "./types";

const zones = new Set<SnapZone>(["left", "right", "top", "tl", "tr", "bl", "br", "l13", "r23", "l23", "r13"]);
function validRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object") return false;
  const r = value as Rect;
  return [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;
}

/** Ignore corrupt entries without discarding the remaining saved workspace. */
export function parseLayout(raw: string): PersistedWindow[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.filter((entry): entry is PersistedWindow => {
    if (!entry || typeof entry !== "object" || !validRect(entry)) return false;
    const p = entry as PersistedWindow;
    if (typeof p.id !== "string" || !p.id || ["__proto__", "constructor", "prototype"].includes(p.id) || ids.has(p.id) || typeof p.app !== "string" || !p.app || typeof p.title !== "string") return false;
    if (typeof p.minimized !== "boolean" || typeof p.maximized !== "boolean") return false;
    if (p.snapZone !== undefined && !zones.has(p.snapZone)) return false;
    if (p.preferredRect !== undefined && !validRect(p.preferredRect)) return false;
    if (p.prevRect !== undefined && !validRect(p.prevRect)) return false;
    ids.add(p.id);
    return true;
  });
}
