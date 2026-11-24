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

export function buildPathSegments(rawPath: string): PathCrumb[] {
  const raw = rawPath || "~";
  if (raw === "~" || raw === "/") {
    return [{ label: raw === "~" ? "Home" : "Root", path: raw }];
  }
  const isAbs = raw.startsWith("/");
  const crumbs: PathCrumb[] = [{ label: isAbs ? "Root" : "Home", path: isAbs ? "/" : "~" }];
  let acc = isAbs ? "" : "~";
  for (const part of raw.split("/").filter(Boolean)) {
    if (!isAbs && part === "~") continue;
    acc = acc === "" ? `/${part}` : `${acc}/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}
