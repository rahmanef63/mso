import { promises as fs } from "node:fs";
import path from "node:path";
import type { FsList } from "@/lib/os-api/types";
import { HostError } from "./host-error";
import { isCredentialPath, resolveReadable, resolveRoots } from "./paths";
import { projectAliasTarget } from "./project-aliases";

const MAX_ENTRIES = 10_000, MAX_BYTES = 256 * 1024, TIME_MS = 5_000;
let active = 0;
// ponytail: two process-wide scans; per-tenant admission if tenant browsing is added.
async function bounded<T>(signal: AbortSignal | undefined, run: (charge: (bytes?: number) => void) => Promise<T>): Promise<T> {
  if (active >= 2) throw new HostError("Filesystem enumeration busy", 429);
  active++;
  const deadline = Date.now() + TIME_MS;
  let entries = 0, bytes = 0;
  const charge = (size = 0) => {
    if (signal?.aborted) throw new HostError("Filesystem enumeration cancelled", 408);
    if (Date.now() > deadline || ++entries > MAX_ENTRIES || (bytes += size) > MAX_BYTES)
      throw new HostError("Filesystem enumeration budget exceeded; choose a narrower directory", 413);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = run(charge).finally(() => { active--; });
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HostError("Filesystem enumeration deadline exceeded", 408)), TIME_MS);
    })]);
  } finally { clearTimeout(timer); }
}

export async function listDir(requested: string, includeHidden = true, signal?: AbortSignal): Promise<FsList> {
  return bounded(signal, async (charge) => {
    charge();
    const real = await resolveReadable(requested || "~");
    const entries: FsList["entries"] = [];
    const dir = await fs.opendir(real);
    for await (const e of dir) {
      charge();
      if ((!includeHidden && e.name.startsWith(".")) || isCredentialPath(path.join(real, e.name))) continue;
      const entry = { name: e.name, kind: e.isDirectory() || e.isSymbolicLink() ? "dir" as const : "file" as const, size: 0, ext: e.name.includes(".") ? e.name.split(".").pop() : undefined };
      charge(Buffer.byteLength(JSON.stringify(entry)));
      if (entries.length >= 1000) throw new HostError("Directory exceeds 1000 entries; choose a narrower directory", 413);
      entries.push(entry);
    }
    entries.sort((a, b) => a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name));
    const candidate = path.dirname(real);
    const parent = candidate === real ? null : await resolveReadable(candidate).catch(() => null);
    return { path: real, entries, roots: resolveRoots(), parent };
  });
}

const SEARCH_SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "vendor", ".pnpm-store", ".turbo"]);
export async function searchFs(query: string, opts: { root?: string; max?: number; maxDepth?: number; signal?: AbortSignal } = {}): Promise<{ name: string; path: string; kind: "dir" }[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return bounded(opts.signal, async (charge) => {
    const root = await resolveReadable(opts.root ?? "~/projects");
    const max = Number.isFinite(opts.max) ? Math.max(1, Math.min(100, Math.trunc(opts.max!))) : 30;
    const maxDepth = Number.isFinite(opts.maxDepth) ? Math.max(0, Math.min(8, Math.trunc(opts.maxDepth!))) : 6;
    const out: { name: string; path: string; kind: "dir" }[] = [];
    const alias = projectAliasTarget(query);
    if (alias) {
      charge();
      const candidate = await resolveReadable(path.join(root, alias)).catch(() => null);
      if (candidate && (await fs.stat(candidate).catch(() => null))?.isDirectory()) return [{ name: alias, path: candidate, kind: "dir" }];
    }
    async function walk(dirPath: string, depth: number): Promise<void> {
      if (out.length >= max || depth > maxDepth) return;
      charge();
      const authorizedPath = await resolveReadable(dirPath).catch(() => null);
      if (!authorizedPath) return;
      const dir = await fs.opendir(authorizedPath).catch(() => null);
      if (!dir) return;
      for await (const e of dir) {
        charge();
        if (out.length >= max) return;
        const hitPath = path.join(authorizedPath, e.name);
        if (!e.isDirectory() || isCredentialPath(hitPath)) continue;
        if (e.name.toLowerCase().includes(q)) {
          const hit = { name: e.name, path: hitPath, kind: "dir" as const };
          charge(Buffer.byteLength(JSON.stringify(hit)));
          out.push(hit);
        }
        if (!SEARCH_SKIP.has(e.name) && !e.name.startsWith(".")) await walk(hitPath, depth + 1);
      }
    }
    await walk(root, 0);
    return out;
  });
}
