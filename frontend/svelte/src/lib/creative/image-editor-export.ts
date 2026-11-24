import { writeTextFile } from "../files/files-api.ts";
import { detectShellBridge, type ShellBridge } from "../shell-bridge.ts";
import { renderDocumentToCanvas } from "./image-editor-render.ts";
import { clampNumber, type EditorDocument, type ExportFormat } from "./image-editor-state.ts";

export function exportFormatMime(format: ExportFormat): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

export function exportFormatExtension(format: ExportFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export function exportDocumentDataUrl(
  doc: EditorDocument,
  imageMap: ReadonlyMap<string, HTMLImageElement>,
  format: ExportFormat,
  qualityPercent: number,
): string {
  const canvas = document.createElement("canvas");
  const ok = renderDocumentToCanvas(canvas, doc, { imageMap, showSelection: false });
  if (!ok) throw new Error("Canvas 2D context is unavailable.");
  const mime = exportFormatMime(format);
  const quality = clampNumber(qualityPercent, 10, 100) / 100;
  return format === "png" ? canvas.toDataURL(mime) : canvas.toDataURL(mime, quality);
}

export function triggerImageDownload(dataUrl: string, format: ExportFormat): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `edited-image.${exportFormatExtension(format)}`;
  link.click();
}

export async function saveExportToVps(
  targetPath: string,
  dataUrl: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<void> {
  const trimmed = targetPath.trim();
  if (!trimmed) throw new Error("Target VPS path is required.");
  await writeTextFile(trimmed, dataUrl, signal, fetcher, bridge);
}
