import { buildStudioFilter, clampNumber } from "./image-editor-state.ts";
import { effectiveCanvasSize } from "./image-editor-geometry.ts";
import type {
  DrawStroke, DrawingLayer, EditorDocument, EditorLayer, ShapeLayer, TextLayer,
} from "./image-editor-types.ts";

function drawStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke): void {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, stroke.size);
  if (stroke.mode === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.globalAlpha = 1;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.globalAlpha = clampNumber(stroke.opacity, 0.05, 1);
  }
  const first = stroke.points[0]!;
  if (stroke.points.length === 1) {
    ctx.beginPath();
    ctx.arc(first.x, first.y, Math.max(1, stroke.size) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      const pt = stroke.points[i]!;
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawDrawingLayer(
  ctx: CanvasRenderingContext2D,
  layer: DrawingLayer,
  docWidth: number,
  docHeight: number,
  previewStroke?: DrawStroke | null,
): void {
  const strokes = previewStroke ? [...layer.strokes, previewStroke] : layer.strokes;
  if (strokes.length === 0) return;
  if (typeof document !== "undefined") {
    const off = document.createElement("canvas");
    off.width = docWidth;
    off.height = docHeight;
    const octx = off.getContext("2d");
    if (octx) {
      for (const stroke of strokes) drawStroke(octx, stroke);
      ctx.drawImage(off, 0, 0);
      return;
    }
  }
  for (const stroke of strokes) drawStroke(ctx, stroke);
}

export function drawShapeLayer(ctx: CanvasRenderingContext2D, layer: ShapeLayer): void {
  ctx.save();
  ctx.strokeStyle = layer.strokeColor;
  ctx.fillStyle = layer.fillColor;
  ctx.lineWidth = Math.max(1, layer.strokeWidth);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (layer.shapeKind === "rect") {
    if (layer.filled) ctx.fillRect(layer.x, layer.y, layer.width, layer.height);
    ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
  } else if (layer.shapeKind === "circle") {
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const rx = Math.max(1, Math.abs(layer.width) / 2);
    const ry = Math.max(1, Math.abs(layer.height) / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (layer.filled) ctx.fill();
    ctx.stroke();
  } else {
    const x2 = layer.x + layer.width;
    const y2 = layer.y + layer.height;
    ctx.beginPath();
    ctx.moveTo(layer.x, layer.y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (layer.shapeKind === "arrow") {
      const angle = Math.atan2(y2 - layer.y, x2 - layer.x);
      const headLen = Math.max(12, layer.strokeWidth * 4);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer): void {
  ctx.save();
  ctx.fillStyle = layer.color;
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "top";
  const lines = layer.text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i] ?? "", layer.x, layer.y + i * layer.fontSize * 1.25);
  }
  ctx.restore();
}

export function drawSelectionBox(ctx: CanvasRenderingContext2D, layer: EditorLayer): void {
  if (layer.kind !== "text" && layer.kind !== "shape") return;
  ctx.save();
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  if (layer.kind === "text") {
    const w = Math.max(48, layer.text.length * layer.fontSize * 0.62);
    ctx.strokeRect(layer.x - 4, layer.y - 4, w + 8, layer.fontSize * 1.25 + 8);
  } else {
    const minX = Math.min(layer.x, layer.x + layer.width);
    const minY = Math.min(layer.y, layer.y + layer.height);
    ctx.strokeRect(minX - 4, minY - 4, Math.abs(layer.width) + 8, Math.abs(layer.height) + 8);
  }
  ctx.restore();
}

export type RenderOptions = {
  imageMap: ReadonlyMap<string, HTMLImageElement>;
  selectedLayerId?: string | null;
  previewStroke?: { layerId: string; stroke: DrawStroke } | null;
  previewShape?: ShapeLayer | null;
  showSelection?: boolean;
};

export function renderDocumentToCanvas(
  canvas: HTMLCanvasElement,
  doc: EditorDocument,
  options: RenderOptions,
): boolean {
  const { width: effW, height: effH } = effectiveCanvasSize(doc);
  if (canvas.width !== effW) canvas.width = effW;
  if (canvas.height !== effH) canvas.height = effH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  ctx.clearRect(0, 0, effW, effH);
  ctx.save();
  ctx.translate(effW / 2, effH / 2);
  ctx.rotate((doc.transform.rotateDeg * Math.PI) / 180);
  ctx.scale(doc.transform.flipH ? -1 : 1, doc.transform.flipV ? -1 : 1);
  ctx.translate(-doc.width / 2, -doc.height / 2);

  if (doc.background && doc.background !== "transparent") {
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }

  const filterStr = buildStudioFilter(doc.adjustments);
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = clampNumber(layer.opacity, 0, 1);
    if (layer.kind === "image") {
      const img = options.imageMap.get(layer.src);
      if (img && img.naturalWidth > 0) {
        ctx.filter = filterStr;
        ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height);
      }
    } else if (layer.kind === "drawing") {
      const preview = options.previewStroke?.layerId === layer.id ? options.previewStroke.stroke : null;
      drawDrawingLayer(ctx, layer, doc.width, doc.height, preview);
    } else if (layer.kind === "shape") {
      drawShapeLayer(ctx, layer);
    } else if (layer.kind === "text") {
      drawTextLayer(ctx, layer);
    }
    ctx.restore();
  }

  if (options.previewShape) {
    ctx.save();
    ctx.globalAlpha = clampNumber(options.previewShape.opacity, 0, 1);
    drawShapeLayer(ctx, options.previewShape);
    ctx.restore();
  }

  const vignette = clampNumber(doc.adjustments.vignette, 0, 100);
  if (vignette > 0) {
    const cx = doc.width / 2;
    const cy = doc.height / 2;
    const outer = Math.hypot(cx, cy);
    const grad = ctx.createRadialGradient(cx, cy, outer * 0.35, cx, cy, outer);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(0,0,0,${(vignette / 100) * 0.85})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }

  if (options.showSelection && options.selectedLayerId) {
    const sel = doc.layers.find((l) => l.id === options.selectedLayerId);
    if (sel && sel.visible) drawSelectionBox(ctx, sel);
  }

  ctx.restore();
  return true;
}
