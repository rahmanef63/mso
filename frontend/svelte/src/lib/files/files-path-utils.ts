import type { PathCrumb } from "./FilesChromeHeader.svelte";

export function joinFsPath(dir: string, name: string): string {
  if (!dir || dir === "/") return `/${name}`;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

export function validateEntryName(raw: string, label = "Folder"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return `${label} name is required.`;
  if (trimmed === "." || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return `${label} name must be a single segment without slashes or "..".`;
  }
  return null;
}

/** Breadcrumb trail anchored on a real readable root.
 *  `/` and `/home` are never readable roots: `resolveRoots()` returns home plus
 *  the configured roots only, and the backend fails anything else closed with
 *  "not_found". Emitting a crumb for those produces a control that always 404s,
 *  so the trail starts at the longest root that prefixes the current path. */
export function buildPathSegments(
  rawPath: string,
  roots: readonly { label: string; path: string }[] = [],
): PathCrumb[] {
  const raw = rawPath || "~";
  const anchor = pickRootAnchor(raw, roots);
  if (!anchor) {
    // No known root prefixes this path (unknown or unlisted location). `~` is the
    // only target the backend always resolves, so anchor there instead of emitting
    // a crumb that is guaranteed to 404.
    return [{ label: "Home", path: "~" }];
  }
  const crumbs: PathCrumb[] = [{ label: anchor.label, path: anchor.path }];
  const rel = raw.slice(anchor.path.length).split("/").filter(Boolean);
  let acc = anchor.path === "/" ? "" : anchor.path;
  for (const part of rel) {
    acc = `${acc}/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

function pickRootAnchor(
  raw: string,
  roots: readonly { label: string; path: string }[],
): { label: string; path: string } | null {
  let best: { label: string; path: string } | null = null;
  for (const root of roots) {
    if (!root.path || root.path === "/") continue;
    const hit = raw === root.path || raw.startsWith(`${root.path}/`);
    if (hit && (!best || root.path.length > best.path.length)) best = { label: root.label, path: root.path };
  }
  return best;
}
