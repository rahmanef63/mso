import type { EditorDocument } from "./image-editor-types.ts";
import { jsonClone } from "./json-clone.ts";

let uidCounter = 0;

export function createId(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

export function cloneDocument(doc: EditorDocument): EditorDocument {
  return jsonClone(doc);
}

export function clampNumber(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}
