import type { FsEntry, FsRoot } from "./types";

// Seed data + helpers for the in-browser mock FS. Split out of mock-adapter.ts
// (CLAUDE.md max-200-LOC rule). The whole demo (zero backend) reads from these.

export const GiB = 1024 ** 3;
export const delay = <T,>(v: T, ms = 160): Promise<T> =>
  new Promise((r) => setTimeout(() => r(v), ms + Math.random() * 120));

export const f = (name: string, size: number, ext: string): FsEntry => ({
  name,
  kind: "file",
  size,
  ext,
});
export const d = (name: string): FsEntry => ({ name, kind: "dir", size: 0 });

export const MOCK_FS: Record<string, FsEntry[]> = {
  "/": [d("Projects"), d("Downloads"), d("Documents"), d("apps"),
    f("readme.md", 1840, "md"), f("notes.txt", 612, "txt")],
  "/Projects": [d("example-next-app"), d("example-service"), f("TODO.md", 980, "md")],
  "/Projects/example-next-app": [d("src"), d("logs"), f("package.json", 2_040, "json"), f("README.md", 4_120, "md")],
  "/Projects/example-next-app/src": [f("index.ts", 3_200, "ts"), f("app.tsx", 5_600, "tsx"), f("worker.ts", 2_900, "ts"), f("styles.css", 1_400, "css")],
  "/Projects/example-next-app/logs": [f("worker.log", 2_480, "log"), f("deploy.log", 1_900, "log")],
  "/Projects/example-service": [f("deploy.sh", 1_120, "sh"), f("config.json", 860, "json")],
  "/Downloads": [f("invoice.pdf", 240_000, "pdf"), f("backup.zip", 156_000_000, "zip"),
    f("dataset.csv", 4_200_000, "csv"), f("archive.tar.gz", 64_000_000, "gz")],
  "/Documents": [d("Invoices"), f("resume.pdf", 320_000, "pdf"), f("plan.md", 2_300, "md")],
  "/Documents/Invoices": [f("2026-01.pdf", 88_000, "pdf"), f("2026-02.pdf", 91_000, "pdf")],
  "/apps": [d("nginx"), d("convex"), f("manifest.json", 1_280, "json")],
  "/apps/nginx": [],
  "/apps/convex": [],
  "/.Trash": [],
};

// "~" (home) and "" both map to the mock root "/" so the portable home token
// the UI uses works the same in mock as it does live; "~/x" maps to "/x".
export const norm = (p: string) => {
  if (p === "/" || p === "~" || p === "") return "/";
  const abs = p.startsWith("~/") ? `/${p.slice(2)}` : p;
  return abs.replace(/\/+$/, "");
};
export const parentOf = (p: string) => {
  const n = norm(p);
  const i = n.lastIndexOf("/");
  return i <= 0 ? "/" : n.slice(0, i);
};
export const baseOf = (p: string) => norm(p).slice(norm(p).lastIndexOf("/") + 1);
export const join = (base: string, name: string) =>
  base === "/" ? "/" + name : base + "/" + name;

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

// Demo media folder — real uploadable files under public/demo-media/, listed
// from its build-time manifest. Lets the (mock/demo) Files app open real
// image/video/audio (served statically, no host). See scripts/gen-demo-media.mjs.
export const DEMO_MEDIA_DIR = "/demo-media";
type DemoItem = { name: string; size?: number };
export async function listDemoMedia(): Promise<FsEntry[]> {
  try {
    const r = await fetch("/demo-media/manifest.json", { cache: "no-store" });
    if (!r.ok) return [];
    const items: unknown = await r.json();
    return (Array.isArray(items) ? items : [])
      .map((it): DemoItem => (typeof it === "string" ? { name: it } : (it as DemoItem)))
      .filter((it) => it && typeof it.name === "string")
      .map((it) => f(it.name, it.size ?? 0, extOf(it.name)));
  } catch {
    return [];
  }
}

export const MOCK_ROOTS: FsRoot[] = [
  { label: "Home", path: "~" },
  { label: "Media", path: DEMO_MEDIA_DIR },
  { label: "Projects", path: "/Projects" },
  { label: "Documents", path: "/Documents" },
];

// Demo persistence — the mock FS tree (folder/file STRUCTURE, not file bytes)
// is mirrored to localStorage so a visitor's sandbox survives a page reload.
// Bytes are intentionally not stored (5 MB cap + binary); reads stay mock.
const DEMO_FS_KEY = "mso:demo-fs";
const DEMO_FS_VERSION = 2;

export function loadDemoTree(): Record<string, FsEntry[]> {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(DEMO_FS_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.v === DEMO_FS_VERSION && saved.tree) return saved.tree;
    } catch {
      /* corrupt / unavailable → fall back to the seed */
    }
  }
  return structuredClone(MOCK_FS);
}

export function saveDemoTree(tree: Record<string, FsEntry[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_FS_KEY, JSON.stringify({ v: DEMO_FS_VERSION, tree }));
  } catch {
    /* quota exceeded / private mode — sandbox just won't persist */
  }
}
