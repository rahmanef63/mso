import { classifyMediaKind, type MediaKind } from "../media/media-api.ts";
import { createStudioAsset, totalDurationSec, type StudioAsset } from "./creative-state.ts";

export type StudioKindFilter = "all" | "image" | "video" | "audio";
export type StudioViewMode = "grid" | "list";

export type StudioProjectAsset = StudioAsset & {
  notes: string;
  tags: string[];
  sizeBytes?: number;
};

export type StudioBatchSummary = {
  totalCount: number;
  totalDurationSec: number;
  counts: {
    image: number;
    video: number;
    audio: number;
    other: number;
  };
};

export type StudioQueueOffset = {
  id: string;
  startSec: number;
  endSec: number;
};

export function createProjectAsset(
  path: string,
  durationSec?: number,
  sizeBytes?: number,
): StudioProjectAsset {
  const base = createStudioAsset(path, durationSec);
  return {
    ...base,
    notes: "",
    tags: [],
    ...(sizeBytes !== undefined && Number.isFinite(sizeBytes) && sizeBytes >= 0 ? { sizeBytes } : {}),
  };
}

export function duplicateStudioAsset(asset: StudioProjectAsset): StudioProjectAsset {
  const fresh = createStudioAsset(asset.path, asset.durationSec);
  return {
    ...fresh,
    label: `${asset.label} (Copy)`,
    notes: asset.notes,
    tags: [...asset.tags],
    ...(asset.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
  };
}

export function filterStudioAssets(
  assets: readonly StudioProjectAsset[],
  kindFilter: StudioKindFilter,
  query: string,
): StudioProjectAsset[] {
  const q = query.trim().toLowerCase();
  return assets.filter((asset) => {
    if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
    if (!q) return true;
    const hay = `${asset.label} ${asset.path} ${asset.notes} ${asset.tags.join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
}

export function summarizeStudioBatch(assets: readonly StudioProjectAsset[]): StudioBatchSummary {
  const counts = { image: 0, video: 0, audio: 0, other: 0 };
  for (const asset of assets) {
    if (asset.kind === "image") counts.image += 1;
    else if (asset.kind === "video") counts.video += 1;
    else if (asset.kind === "audio") counts.audio += 1;
    else counts.other += 1;
  }
  return {
    totalCount: assets.length,
    totalDurationSec: totalDurationSec(assets),
    counts,
  };
}

export function computeQueueOffsets(
  assets: readonly StudioProjectAsset[],
): Map<string, StudioQueueOffset> {
  const map = new Map<string, StudioQueueOffset>();
  let cursor = 0;
  for (const asset of assets) {
    const startSec = cursor;
    const endSec = cursor + Math.max(0, asset.durationSec);
    map.set(asset.id, { id: asset.id, startSec, endSec });
    cursor = endSec;
  }
  return map;
}

export function addTagToAsset(asset: StudioProjectAsset, rawTag: string): StudioProjectAsset {
  const tag = rawTag.trim().toLowerCase().replace(/\s+/g, "-");
  if (!tag || asset.tags.includes(tag)) return asset;
  return { ...asset, tags: [...asset.tags, tag] };
}

export function removeTagFromAsset(asset: StudioProjectAsset, tag: string): StudioProjectAsset {
  return { ...asset, tags: asset.tags.filter((item) => item !== tag) };
}

export function isImportableMediaFile(name: string, mime?: string): MediaKind | null {
  if (mime) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
  }
  const kind = classifyMediaKind(name);
  if (kind === "image" || kind === "video" || kind === "audio") return kind;
  return null;
}

export function joinHostPath(dir: string, name: string): string {
  const cleanDir = dir.trim() || "~";
  if (cleanDir.endsWith("/")) return `${cleanDir}${name}`;
  return `${cleanDir}/${name}`;
}

export function formatBytesCompact(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildStudioManifest(
  projectTitle: string,
  assets: readonly StudioProjectAsset[],
) {
  const summary = summarizeStudioBatch(assets);
  const offsets = computeQueueOffsets(assets);
  return {
    schema: "mso.media-studio.manifest.v1",
    exportedAt: new Date().toISOString(),
    projectTitle: projectTitle.trim() || "Untitled Studio Project",
    summary,
    queue: assets.map((asset, index) => {
      const slot = offsets.get(asset.id);
      return {
        order: index + 1,
        id: asset.id,
        label: asset.label,
        path: asset.path,
        kind: asset.kind,
        durationSec: asset.durationSec,
        startSec: slot?.startSec ?? 0,
        endSec: slot?.endSec ?? asset.durationSec,
        notes: asset.notes,
        tags: asset.tags,
        ...(asset.sizeBytes !== undefined ? { sizeBytes: asset.sizeBytes } : {}),
      };
    }),
  };
}
