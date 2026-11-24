import type { PathCrumb } from "./FilesChromeHeader.svelte";

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
