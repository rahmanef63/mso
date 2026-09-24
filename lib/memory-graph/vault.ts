// Bounded markdown vault scan. Every file is re-checked with the host read
// jail (resolveReadable) so a symlink cannot escape OS_FS_READ_ROOTS.

import path from "node:path";
import { promises as fs } from "node:fs";
import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import { resolveReadable } from "@/lib/host/paths";
import type { GraphInputNode } from "./types";

const MAX_FILES = 160;
const MAX_DEPTH = 6;
const MAX_DIRS = 400;
const MAX_BYTES = 48 * 1024;
const SKIP = new Set(["node_modules", ".git", ".obsidian", ".mso", ".agent", "dist", ".next", "coverage"]);

export interface VaultScan {
  notes: GraphInputNode[];
  truncated: boolean;
  root: string | null;
  warning?: string;
}

function titleFrom(body: string, filename: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = heading || filename.replace(/\.md$/i, "");
  return title.slice(0, 80) || filename;
}

function excerptFrom(body: string): string {
  const plain = body.replace(/^#\s+.+$/m, "").replace(/\s+/g, " ").trim();
  return plain.slice(0, 160);
}

export async function readVaultNotes(requested: string): Promise<VaultScan> {
  const rootRequest = requested.trim();
  if (!rootRequest) return { notes: [], truncated: false, root: null };
  let root: string;
  try {
    root = await resolveReadable(rootRequest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable vault";
    return { notes: [], truncated: false, root: null, warning: message.slice(0, 180) };
  }
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return { notes: [], truncated: false, root: null, warning: "Memory graph root must be a real directory" };
  }

  const notes: GraphInputNode[] = [];
  const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: root, rel: "", depth: 0 }];
  let dirs = 0;
  let truncated = false;

  while (queue.length && notes.length < MAX_FILES && dirs < MAX_DIRS) {
    const current = queue.shift()!;
    dirs += 1;
    const entries = await fs.readdir(current.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(current.dir, entry.name);
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (current.depth < MAX_DEPTH) queue.push({ dir: full, rel, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      if (notes.length >= MAX_FILES) { truncated = true; break; }
      let readable: string;
      try { readable = await resolveReadable(full); } catch { continue; }
      const body = await readBoundedRegularFile(readable, MAX_BYTES);
      if (body === null) { truncated = true; continue; }
      const stem = rel.replace(/\.md$/i, "");
      const group = stem.includes("/") ? stem.split("/")[0]! : "Notes";
      notes.push({
        id: `note:${stem}`,
        title: titleFrom(body, entry.name),
        kind: "note",
        group,
        path: readable,
        excerpt: excerptFrom(body),
        text: body,
      });
    }
  }
  if (queue.length) truncated = true;
  return { notes, truncated, root };
}
