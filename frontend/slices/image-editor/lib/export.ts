import type Konva from "konva";
import { saveAs } from "@/features/appshell";

export type ExportFormat = "png" | "jpeg" | "webp";

const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// Where the document sits on the stage: its top-left in stage pixels (= pan) and
// the on-screen zoom. Output is captured at 1:1 document resolution × `scale`.
export type DocView = { x: number; y: number; width: number; height: number; zoom: number };

// Hide the UI-only chrome (Transformer/selection handles + the doc drop-shadow
// affordance), run `fn`, then restore — so the capture is the DOCUMENT, not the
// viewport. Returns whatever `fn` returns.
function withCleanStage<T>(stage: Konva.Stage, fn: () => T): T {
  // The doc-bg is the named Rect carrying the UI drop-shadow affordance.
  const docBg = stage.findOne<Konva.Shape>(".doc-bg");
  const shadow = docBg
    ? { color: docBg.shadowColor(), blur: docBg.shadowBlur(), opacity: docBg.shadowOpacity() }
    : null;
  // The Transformer lives in its own (top-most) Konva layer; hide that layer so
  // the selection box/anchors never bake into the export.
  const overlay = stage.getLayers().at(-1) ?? null;
  const overlayVisible = overlay?.visible() ?? true;
  if (docBg) {
    docBg.shadowColor("transparent");
    docBg.shadowBlur(0);
    docBg.shadowOpacity(0);
  }
  if (overlay) overlay.visible(false);
  try {
    return fn();
  } finally {
    if (docBg && shadow) {
      docBg.shadowColor(shadow.color);
      docBg.shadowBlur(shadow.blur);
      docBg.shadowOpacity(shadow.opacity);
    }
    if (overlay) overlay.visible(overlayVisible);
    stage.draw();
  }
}

// Render the stage to a data URL. With a `view`, only the document rectangle is
// captured at 1:1 doc resolution (pixelRatio normalizes the current zoom), so the
// output is zoom-independent and excludes pasteboard padding + UI overlays.
// `scale` multiplies that (2 = 2× the doc size). JPEG/WebP take quality 0..1.
export function stageToDataURL(
  stage: Konva.Stage,
  opts: { format?: ExportFormat; quality?: number; scale?: number; view?: DocView } = {},
): string {
  const { format = "png", quality = 0.92, scale = 1, view } = opts;
  const mimeType = MIME[format];
  if (!view) {
    return withCleanStage(stage, () => stage.toDataURL({ mimeType, quality, pixelRatio: scale }));
  }
  return withCleanStage(stage, () =>
    stage.toDataURL({
      mimeType,
      quality,
      x: view.x,
      y: view.y,
      width: view.width * view.zoom,
      height: view.height * view.zoom,
      // 1/zoom maps on-screen pixels back to doc pixels (zoom-independent);
      // `scale` then exports at a multiple of the document size.
      pixelRatio: (1 / view.zoom) * scale,
    }),
  );
}

const downloadDataURL = (dataURL: string, filename: string) => saveAs(dataURL, filename);

export function exportStage(
  stage: Konva.Stage,
  opts: { format?: ExportFormat; quality?: number; scale?: number; view?: DocView; name?: string } = {},
) {
  const format = opts.format ?? "png";
  const url = stageToDataURL(stage, opts);
  downloadDataURL(url, `${opts.name ?? "export"}.${format === "jpeg" ? "jpg" : format}`);
}
