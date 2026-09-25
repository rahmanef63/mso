import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { redactText } from "@/lib/security/redact-text";
import { existing, safeRelative, readBytes } from "./io";
import type { Source } from "./sources";
export const LIMITS = { files: 5000, entries: 15000, bytes: 128 * 1024 * 1024, fileBytes: 8 * 1024 * 1024, ms: 20000 };
export type Limits = typeof LIMITS;
export type Scan = { files: number; bytes: number; missing: number; rejected: number; truncated: boolean };
const excluded = /(?:^\.env|credential|secret|password|token|config|browser|profile|^\.ssh$|^\.git$|^node_modules$|^locks?$|\.lock(?:\.|$)|\.tmp$)/i;
export async function scanSources(sources: Source[], limits: Limits, consume?: (name: string, data: Buffer) => Promise<void>): Promise<Scan> {
  const report: Scan = { files: 0, bytes: 0, missing: 0, rejected: 0, truncated: false };
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
            if (excluded.test(entry.name)) { entries++; continue; }
            await visit(path.join(file, entry.name), `${name}/${entry.name}`, depth + 1);
          }
        } finally { await pin.directory.close(); }
      } else {
        if (!stat.isFile() || excluded.test(path.basename(file))) { report.rejected++; return; }
        if (stat.size > limits.fileBytes || stat.size + report.bytes > limits.bytes) { report.truncated = true; return; }
        const bytes = await readBytes(file, limits.fileBytes);
        if (bytes.length + report.bytes > limits.bytes) { report.truncated = true; return; }
        // Never transform a snapshot silently: suspected embedded secrets omit the file.
        const text = (file.endsWith(".gz") ? gunzipSync(bytes, { maxOutputLength: limits.fileBytes }) : bytes).toString("utf8");
        if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) || redactText(text) !== text) { report.rejected++; return; }
        await consume?.(name, bytes);
        report.files++; report.bytes += bytes.length;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") report.missing++;
      else report.rejected++;
    }
  }
  for (const source of sources) await visit(source.path, source.key, 0);
  return report;
}
