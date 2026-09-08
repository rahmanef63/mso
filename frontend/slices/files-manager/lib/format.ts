const GiB = 1024 ** 3;

// Bytes → "X.X GiB". rr: pure helper, no UI.
export function fmtGiB(bytes: number): string {
  return `${(bytes / GiB).toFixed(1)} GiB`;
}

// Bytes → compact human size for list/grid rows.
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < GiB) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / GiB).toFixed(1)} GB`;
}

// Path helpers live in the framework now — three slices needed them and their
// three copies disagreed about a trailing slash, which becomes a doubled slash in
// an /api/v1/fs `path=`. Re-exported here so this slice's own imports are unchanged.
export { joinPath, parentPath, baseName } from "@/lib/path";

// Breadcrumb segments for a path, including the synthetic root.
export function crumbsFor(path: string, root = "mso"): { name: string; path: string }[] {
  if (path === "~" || path.startsWith("~/")) {
    const parts = path.slice(2).split("/").filter(Boolean);
    return [{ name: "Home", path: "~" }, ...parts.map((name, i) => ({ name, path: "~/" + parts.slice(0, i + 1).join("/") }))];
  }
  const head = { name: root, path: "/" };
  if (path === "/") return [head];
  const parts = path.split("/").filter(Boolean);
  return [
    head,
    ...parts.map((name, i) => ({ name, path: "/" + parts.slice(0, i + 1).join("/") })),
  ];
}

// Pick a non-colliding name within `taken` by appending " copy".
export function uniqueName(taken: Set<string>, name: string): string {
  let nm = name;
  while (taken.has(nm)) {
    const dot = nm.lastIndexOf(".");
    nm = dot > 0 ? nm.slice(0, dot) + " copy" + nm.slice(dot) : nm + " copy";
  }
  return nm;
}
