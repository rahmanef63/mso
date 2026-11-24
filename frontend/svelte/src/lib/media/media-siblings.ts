import { listDirectory, type ShellBridge } from "../files/files-api.ts";
import { classifyMediaKind, type MediaKind } from "./media-api.ts";

export type MediaSibling = { path: string; name: string; kind: MediaKind };

export function parentDirectory(path: string): string {
  const clean = path.trim();
  const cut = clean.replace(/\\/g, "/").lastIndexOf("/");
  if (cut < 0) return "~";
  if (cut === 0) return "/";
  return clean.slice(0, cut);
}

export function joinPath(dir: string, name: string): string {
  if (!dir || dir === "~") return `~/${name}`;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** Files the viewer can actually render. Paging onto an archive would put a
 *  download card between two photos, so unsupported entries stay out. */
export function isPreviewable(kind: MediaKind): boolean {
  return kind === "image" || kind === "audio" || kind === "video" || kind === "text";
}

export async function readMediaSiblings(
  path: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge?: ShellBridge,
): Promise<MediaSibling[]> {
  const dir = parentDirectory(path);
  const listing = await listDirectory(dir, signal, fetcher, bridge);
  const base = listing.path || dir;
  return listing.entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => ({ path: joinPath(base, entry.name), name: entry.name, kind: classifyMediaKind(entry.name) }))
    .filter((entry) => isPreviewable(entry.kind));
}

/** Wraps around the folder, the way every OS preview does. */
export function stepSibling(
  items: readonly MediaSibling[],
  current: string,
  name: string,
  delta: number,
): MediaSibling | null {
  if (items.length < 2) return null;
  const index = items.findIndex((item) => item.path === current || item.name === name);
  if (index < 0) return null;
  return items[(index + delta + items.length) % items.length] ?? null;
}

export function siblingIndex(items: readonly MediaSibling[], current: string, name: string): number {
  return items.findIndex((item) => item.path === current || item.name === name);
}
