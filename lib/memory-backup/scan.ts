import { promises as fs } from "node:fs";
import path from "node:path";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { existing, safeRelative, readBytes } from "./io";
import type { Source } from "./sources";
export const LIMITS = { files: 10000, entries: 40000, bytes: 1024 * 1024 * 1024, fileBytes: 32 * 1024 * 1024, ms: 45000 };
export type Limits = typeof LIMITS;
export type Scan = import("@/lib/contracts/memory-backup").MemoryBackupScan;
const excluded = /(?:^\.env|credential|secret|password|token|config|browser|profile|^\.ssh$|^\.git$|^node_modules$|^\.?locks?$|workflow-variables|^variables\.json$|\.lock(?:\.|$)|\.tmp$)/i;
export async function scanSources(sources: Source[], limits: Limits, consume?: (name: string, data: Buffer) => Promise<void>): Promise<Scan> {
  const report: Scan = { files: 0, bytes: 0, missing: 0, rejected: 0, excluded: 0, truncated: false };
  const deadline = Date.now() + limits.ms;
  let entries = 0;
  const stopped = () => {
    if (Date.now() >= deadline || entries >= limits.entries || report.files >= limits.files) report.truncated = true;
    return report.truncated;
  };
  async function visit(file: string, name: string, depth: number) {
    if (stopped()) return;
    entries++;
    if (depth > 32 || !safeRelative(name)) { report.rejected++; return; }
    try {
      await existing(file);
      const stat = await fs.lstat(file);
      if (stat.isDirectory()) {
        const pin = await pinSecurityStorePath(path.join(file, ".backup-index"));
        try {
          const dir = await fs.opendir(path.dirname(pin.file));
          for await (const entry of dir) {
            if (stopped()) break;
            if (excluded.test(entry.name)) { entries++; report.excluded++; continue; }
            await visit(path.join(file, entry.name), `${name}/${entry.name}`, depth + 1);
          }
        } finally { await pin.directory.close(); }
      } else {
        if (!stat.isFile() || excluded.test(path.basename(file))) { report.rejected++; return; }
        if (stat.size > limits.fileBytes || stat.size + report.bytes > limits.bytes) { report.truncated = true; return; }
        if (!consume) { report.files++; report.bytes += stat.size; return; }
        const bytes = await readBytes(file, limits.fileBytes);
        if (bytes.length + report.bytes > limits.bytes) { report.truncated = true; return; }
        // Private source bytes are copied exactly, never emitted to the caller.
        // Credential/config/browser stores are outside the allowlisted sources.
        await consume(name, bytes);
        report.files++; report.bytes += bytes.length;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && depth === 0) report.missing++;
      else report.rejected++;
    }
  }
  for (const source of sources) await visit(source.path, source.key, 0);
  return report;
}
