import {
  filterCssForPreset,
  getAspectPreset,
  type AspectRatioId,
  type ReelCaption,
  type ReelTimelineClip,
} from "./reel-model.ts";

export function downloadJsonFile(filename: string, data: unknown): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  return true;
}

export function slugifyFilename(title: string, fallback: string): string {
  const clean = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || fallback;
}

export function captureStageSnapshot(input: {
  title: string;
  aspect: AspectRatioId;
  activeClip: ReelTimelineClip | null;
  caption: ReelCaption | null;
  timeLabel: string;
  mediaEl: HTMLImageElement | HTMLVideoElement | null;
}): { ok: boolean; message: string } {
  if (typeof document === "undefined") {
    return { ok: false, message: "Snapshot requires a browser canvas." };
  }
  const preset = getAspectPreset(input.aspect);
  const scale = 0.5;
  const w = Math.round(preset.width * scale);
  const h = Math.round(preset.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, message: "Canvas 2D context is unavailable." };

  ctx.fillStyle = input.activeClip?.backdropColor ?? "#11131a";
  ctx.fillRect(0, 0, w, h);

  if (input.mediaEl && input.activeClip) {
    try {
      ctx.save();
      ctx.filter = filterCssForPreset(input.activeClip.filter);
      const sw = input.mediaEl instanceof HTMLVideoElement ? input.mediaEl.videoWidth : input.mediaEl.naturalWidth;
      const sh = input.mediaEl instanceof HTMLVideoElement ? input.mediaEl.videoHeight : input.mediaEl.naturalHeight;
      if (sw > 0 && sh > 0) {
        const scaleFn = input.activeClip.fit === "contain" ? Math.min : Math.max;
        const ratio = scaleFn(w / sw, h / sh);
        const dw = sw * ratio;
        const dh = sh * ratio;
        ctx.drawImage(input.mediaEl, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
      ctx.restore();
    } catch {
      ctx.restore();
    }
  } else if (input.activeClip) {
    ctx.fillStyle = "#f4f4f7";
    ctx.font = "700 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(input.activeClip.title, w / 2, h / 2 - 10);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "500 16px monospace";
    ctx.fillText(input.timeLabel, w / 2, h / 2 + 24);
  }

  const captionText = input.caption?.text || input.activeClip?.caption || "";
  if (captionText) {
    const pos = input.caption?.position ?? "bottom";
    const y = pos === "top" ? h * 0.16 : pos === "center" ? h * 0.5 : h * 0.84;
    const fontSize = Math.round((input.caption?.fontSizePx ?? 16) * 1.4);
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    const metrics = ctx.measureText(captionText);
    const padX = 18;
    const boxW = Math.min(w - 32, metrics.width + padX * 2);
    const boxH = fontSize + 18;
    if (input.caption?.bgPill !== false) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
      ctx.fillRect((w - boxW) / 2, y - boxH / 2, boxW, boxH);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(captionText, w / 2, y + fontSize * 0.35, w - 48);
  }

  try {
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugifyFilename(input.title, "reel")}-frame.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return { ok: true, message: "Saved frame snapshot PNG." };
  } catch {
    return { ok: false, message: "Browser blocked PNG export for cross-origin media." };
  }
}
