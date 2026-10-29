import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { globFs, globToRegExp, type GlobInput, type GlobResult, walkFiles } from "./fs-glob";
import { resolveReadable } from "./paths";

export { globFs, globToRegExp, type GlobInput, type GlobResult };

const MAX_FILE_SIZE = 1024 * 1024; // 1 MiB
const MAX_TOTAL_BYTES = 64 * 1024 * 1024; // 64 MiB
const BINARY_CHECK_BYTES = 8192; // 8 KiB
const DEFAULT_MAX_MATCHES = 200;
const HARD_CAP_MAX_MATCHES = 1000;

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  truncated: boolean;
  filesScanned: number;
  reason?: string;
  error?: string;
}

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  max_matches?: number;
  maxMatches?: number;
  case_sensitive?: boolean;
  caseSensitive?: boolean;
}

export async function grepFs(input: GrepInput): Promise<GrepResult> {
  const { pattern, path: requestedPath, glob: globFilter } = input;
  const caseSensitive = input.case_sensitive ?? input.caseSensitive ?? true;
  const rawMax = input.max_matches ?? input.maxMatches ?? DEFAULT_MAX_MATCHES;
  const maxMatches = Math.max(1, Math.min(HARD_CAP_MAX_MATCHES, Number.isFinite(rawMax) ? Math.trunc(rawMax) : DEFAULT_MAX_MATCHES));

  if (!pattern || typeof pattern !== "string") {
    return { error: "pattern must be a non-empty string", matches: [], truncated: false, filesScanned: 0 };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, caseSensitive ? "" : "i");
  } catch (err) {
    return {
      error: `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
      matches: [],
      truncated: false,
      filesScanned: 0,
    };
  }

  let globRegex: RegExp | undefined;
  if (globFilter && typeof globFilter === "string") {
    try { globRegex = globToRegExp(globFilter); } catch {}
  }

  const targetRoot = requestedPath && requestedPath.trim() ? requestedPath.trim() : process.cwd();
  const resolvedRoot = await resolveReadable(targetRoot);

  const matches: GrepMatch[] = [];
  let truncated = false;
  let reason: string | undefined;
  let totalBytesScanned = 0;
  let filesScanned = 0;

  await walkFiles(resolvedRoot, async (filePath) => {
    const relPath = path.relative(resolvedRoot, filePath).replace(/\\/g, "/");
    if (globRegex && !globRegex.test(relPath)) return true;

    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(filePath, constants.O_RDONLY);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return true;

      if (totalBytesScanned + stat.size > MAX_TOTAL_BYTES) {
        truncated = true;
        reason = "total_bytes_scanned limit reached (64 MiB)";
        return false;
      }

      const previewLength = Math.min(stat.size, BINARY_CHECK_BYTES);
      const preview = Buffer.alloc(previewLength);
      const { bytesRead } = await handle.read(preview, 0, previewLength, 0);
      if (preview.subarray(0, bytesRead).includes(0)) return true;

      const content = await handle.readFile({ encoding: "utf8" });
      totalBytesScanned += stat.size;
      filesScanned++;

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (regex.test(line)) {
          const cleanLine = line.endsWith("\r") ? line.slice(0, -1) : line;
          matches.push({ path: filePath, line: i + 1, text: cleanLine.slice(0, 400) });
          if (matches.length >= maxMatches) {
            truncated = true;
            reason = "max_matches limit reached";
            return false;
          }
        }
      }
    } catch {
      return true;
    } finally {
      await handle?.close().catch(() => undefined);
    }
    return true;
  });

  return { matches, truncated, filesScanned, ...(reason ? { reason } : {}) };
}
