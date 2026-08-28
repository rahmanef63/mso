import { IMAGE_EDITOR_LIMITS } from "./project-validation";

// Konva-free image I/O — kept OUT of konva-helpers.ts so the editor chrome (top
// bar, menu bar) that only reads a File doesn't drag the whole Konva canvas lib
// into its chunk. Konva loads with the stage (dynamic import), not the chrome.

// Load an image URL → HTMLImageElement (crossOrigin set so toDataURL/export and
// filter caching don't taint the canvas).
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Read a picked File into a self-contained data URL. Opened images MUST be stored
// as data URLs, not `URL.createObjectURL` blob: URLs — a blob: URL is revoked when
// the document unloads, so it gets serialized into autosave/Save and renders null
// after a reload. Data URLs round-trip through persistence intact.
export function fileToDataURL(file: File): Promise<string> {
  if (file.size > IMAGE_EDITOR_LIMITS.maxPickedImageBytes) {
    return Promise.reject(new Error("image exceeds the 16 MiB import limit"));
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
