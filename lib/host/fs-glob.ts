import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { HostError } from "./host-error";
import { isCredentialPath, resolveReadable } from "./paths";

const DEFAULT_MAX_RESULTS = 200;
const HARD_CAP_MAX_RESULTS = 1000;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage"]);

export interface GlobResult {
  paths: string[];
  truncated: boolean;
  reason?: string;
}

export interface GlobInput {
  pattern: string;
  path?: string;
  max_results?: number;
  maxResults?: number;
}

/**
 * Minimal glob-to-RegExp converter.
 *
 * Supported syntax:
 * - `*`: matches any characters within one path segment (stops at `/`)
 * - `**`: matches zero or more path segments across `/`
 * - `?`: matches any single character except `/`
 * - `[...]`: character classes (e.g. `[a-z]`, `[0-9]`), including negation `[!abc]` or `[^abc]`
 *
 * NOT supported syntax:
 * - Brace expansion (e.g. `{ts,tsx}`)
 * - Extended globbing (e.g. `+(...)`, `@(...)`, `!(...)`, `?(...)`)
 * - Multi-segment wildcards embedded in words (e.g. `a**b`)
 * - Escaped backslash literals
 */
export function globToRegExp(pattern: string): RegExp {
  const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  let s = "^", i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i += 2;
        if (p[i] === "/") { s += "(?:.*\\/)?"; i++; }
        else s += ".*";
      } else { s += "[^\\/]*"; i++; }
    } else if (c === "?") { s += "[^\\/]"; i++; }
    else if (c === "[") {
      let j = i + 1, content = "";
      if (j < p.length && (p[j] === "!" || p[j] === "^")) { content += "^"; j++; }
      if (j < p.length && p[j] === "]") { content += "\\]"; j++; }
      while (j < p.length && p[j] !== "]") content += p[j] === "\\" ? (j++, "\\" + (p[j++] ?? "")) : p[j++];
      if (j < p.length) { s += `[${content}]`; i = j + 1; }
      else { s += "\\["; i++; }
    } else if ("/.^$+(){}[]|\\".includes(c)) { s += "\\" + c; i++; }
    else { s += c; i++; }
  }
  return new RegExp(s + "$");
}

export async function walkFiles(root: string, onFile: (filePath: string) => Promise<boolean>): Promise<void> {
  async function walk(dir: string): Promise<boolean> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (isCredentialPath(child)) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !(await walk(child))) return false;
      } else if (entry.isFile()) {
        if (!(await onFile(child))) return false;
      } else if (entry.isSymbolicLink()) {
        const stat = await fs.stat(child).catch(() => null);
        if (stat?.isFile()) {
          const readable = await resolveReadable(child).catch(() => null);
          if (readable && !isCredentialPath(readable) && !(await onFile(child))) return false;
        }
      }
    }
    return true;
  }
  const stat = await fs.stat(root);
  if (stat.isFile()) await onFile(root);
  else if (stat.isDirectory()) await walk(root);
}

export async function globFs(input: GlobInput): Promise<GlobResult> {
  const { pattern, path: requestedPath } = input;
  const rawMax = input.max_results ?? input.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxResults = Math.max(1, Math.min(HARD_CAP_MAX_RESULTS, Number.isFinite(rawMax) ? Math.trunc(rawMax) : DEFAULT_MAX_RESULTS));

  if (!pattern || typeof pattern !== "string") {
    throw new HostError("pattern must be a non-empty string");
  }

  const targetRoot = requestedPath && requestedPath.trim() ? requestedPath.trim() : process.cwd();
  const resolvedRoot = await resolveReadable(targetRoot);

  const regex = globToRegExp(pattern);
  const paths: string[] = [];
  let truncated = false;
  let reason: string | undefined;

  await walkFiles(resolvedRoot, async (filePath) => {
    const relPath = path.relative(resolvedRoot, filePath).replace(/\\/g, "/");
    if (regex.test(relPath)) {
      paths.push(filePath);
      if (paths.length >= maxResults) {
        truncated = true;
        reason = "max_results limit reached";
        return false;
      }
    }
    return true;
  });

  paths.sort((a, b) => a.localeCompare(b));
  return { paths, truncated, ...(reason ? { reason } : {}) };
}
