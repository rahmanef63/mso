// Off-screen media metadata probe — natural pixel dims + finite media duration.
// Used at import time, before a clip's element is added to the MediaCache.

import type { MediaType } from "./mock-timeline";
import { finitePositive } from "./limits";

/** Probe a media URL for natural pixel dims + (video) duration, off-screen. */
export function probeMedia(
  url: string,
  type: MediaType,
): Promise<{ natW: number; natH: number; dur?: number }> {
  return new Promise((resolve, reject) => {
    if (type === "image") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve({ natW: img.naturalWidth || 1280, natH: img.naturalHeight || 720 });
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = url;
      return;
    }
    if (type === "audio") {
      const a = document.createElement("audio");
      a.crossOrigin = "anonymous";
      a.preload = "metadata";
      a.onloadedmetadata = () => resolve({ natW: 0, natH: 0, dur: finitePositive(a.duration) ? a.duration : undefined });
      a.onerror = () => reject(new Error("Could not load audio"));
      a.src = url;
      return;
    }
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "metadata";
    v.onloadedmetadata = () =>
      resolve({ natW: v.videoWidth || 1280, natH: v.videoHeight || 720, dur: finitePositive(v.duration) ? v.duration : undefined });
    v.onerror = () => reject(new Error("Could not load video"));
    v.src = url;
  });
}
