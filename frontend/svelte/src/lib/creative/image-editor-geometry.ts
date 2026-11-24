import type { DocTransform, EditorDocument, Point } from "./image-editor-types.ts";

export function effectiveCanvasSize(doc: EditorDocument): { width: number; height: number } {
  const quarter = doc.transform.rotateDeg === 90 || doc.transform.rotateDeg === 270;
  return quarter ? { width: doc.height, height: doc.width } : { width: doc.width, height: doc.height };
}

export function stagePointToDocPoint(
  stagePt: Point,
  docWidth: number,
  docHeight: number,
  transform: DocTransform,
): Point {
  const quarter = transform.rotateDeg === 90 || transform.rotateDeg === 270;
  const effW = quarter ? docHeight : docWidth;
  const effH = quarter ? docWidth : docHeight;
  let cx = stagePt.x - effW / 2;
  let cy = stagePt.y - effH / 2;
  const rad = (-transform.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = cx * cos - cy * sin;
  const ry = cx * sin + cy * cos;
  cx = transform.flipH ? -rx : rx;
  cy = transform.flipV ? -ry : ry;
  return { x: cx + docWidth / 2, y: cy + docHeight / 2 };
}
