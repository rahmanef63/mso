import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const INDEX_VERSION = 1;
const MAX_INDEX_ENTRIES = 8_000;
const MAX_DIRS = 2_500;
const MAX_DEPTH = 14;

export type CandidateKind = "path" | "skill";
export type CandidateEntry = { path: string; kind: CandidateKind; size: number };
export type CandidateIndex = {
  version: 1;
  projectRoot: string;
  revision: string;
  entries: CandidateEntry[];
  directories: Array<{ path: string; mtimeMs: number }>;
  truncated: boolean;
  truncationReasons: string[];
  createdAt: string;
};

export type ProjectCandidate = CandidateEntry & { score: number };
export type ProjectCandidateMatch = { path: string; line: number; preview: string };

const IGNORED_DIRS = new Set([
  ".git", "node_modules", ".next", ".svelte-kit", ".turbo", "dist", "build", "coverage",
  ".cache", ".parcel-cache", ".vite", "__pycache__", ".venv", "venv",
]);

function cacheRoot(): string {
  return process.env.MSO_CANDIDATE_INDEX_DIR
    ? path.resolve(process.env.MSO_CANDIDATE_INDEX_DIR)
    : path.join(os.homedir(), ".mso", "cache", "candidate-index-v1");
}

function cacheFile(projectPath: string): string {
  const key = createHash("sha256").update(path.resolve(projectPath)).digest("hex").slice(0, 24);
  return path.join(cacheRoot(), `${key}.json`);
}

function ignoredFile(name: string, rel: string): boolean {
  const lower = name.toLowerCase();
  if (/^\.env(?:\.|$)/i.test(name)) return true;
  if ([".npmrc", ".pypirc", "id_rsa", "id_ed25519", "cookies.json", "credentials.json", "auth.json"].includes(lower)) return true;
  if (/\.(?:pem|key|p12|pfx)$/i.test(name)) return true;
  if (rel.startsWith(".mso/") && !rel.startsWith(".mso/skills/") && rel !== ".mso/KNOWLEDGE.md") return true;
  return false;
}

function allowedDir(name: string, rel: string): boolean {
  if (IGNORED_DIRS.has(name)) return false;
  if (name === ".mso") return true;
  if (rel.startsWith(".mso/") && rel !== ".mso/skills" && !rel.startsWith(".mso/skills/")) return false;
  return true;
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
}

async function buildIndex(projectPath: string, revision: string): Promise<CandidateIndex> {
  const root = await fs.realpath(projectPath);
  const entries: CandidateEntry[] = [];
  const directories: Array<{ path: string; mtimeMs: number }> = [];
  const truncationReasons: string[] = [];
  let dirCount = 0;

  const walk = async (dir: string, relDir: string, depth: number): Promise<void> => {
    if (entries.length >= MAX_INDEX_ENTRIES) {
      if (!truncationReasons.includes("maxEntries")) truncationReasons.push("maxEntries");
      return;
    }
    if (dirCount >= MAX_DIRS) {
      if (!truncationReasons.includes("maxDirectories")) truncationReasons.push("maxDirectories");
      return;
    }
    if (depth > MAX_DEPTH) {
      if (!truncationReasons.includes("maxDepth")) truncationReasons.push("maxDepth");
      return;
    }
    dirCount += 1;
    const directoryStat = await fs.stat(dir).catch(() => null);
    if (!directoryStat?.isDirectory()) return;
    directories.push({ path: relDir.split(path.sep).join("/"), mtimeMs: directoryStat.mtimeMs });
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (entries.length >= MAX_INDEX_ENTRIES) {
        if (!truncationReasons.includes("maxEntries")) truncationReasons.push("maxEntries");
        break;
      }
      if (dirent.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      const absolute = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (!allowedDir(dirent.name, rel)) continue;
        await walk(absolute, rel, depth + 1);
        continue;
      }
      if (!dirent.isFile() || ignoredFile(dirent.name, rel)) continue;
      const stat = await fs.stat(absolute).catch(() => null);
      if (!stat?.isFile()) continue;
      entries.push({ path: rel.replace(/\\/g, "/"), kind: dirent.name === "SKILL.md" ? "skill" : "path", size: stat.size });
    }
  };

  await walk(root, "", 0);
  return {
    version: INDEX_VERSION,
    projectRoot: root,
    revision,
    entries,
    directories,
    truncated: truncationReasons.length > 0,
    truncationReasons,
    createdAt: new Date().toISOString(),
  };
}

async function directoryStructureMatches(projectPath: string, directories: CandidateIndex["directories"]): Promise<boolean> {
  const root = await fs.realpath(projectPath);
  for (const directory of directories.slice(0, MAX_DIRS)) {
    const absolute = directory.path ? path.resolve(root, directory.path) : root;
    if (absolute !== root && !absolute.startsWith(root + path.sep)) return false;
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isDirectory() || stat.mtimeMs !== directory.mtimeMs) return false;
  }
  return directories.length > 0;
}

export async function loadCandidateIndex(projectPath: string, revision: string): Promise<{ index: CandidateIndex; rebuilt: boolean }> {
  const file = cacheFile(projectPath);
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as CandidateIndex;
      if (
        parsed?.version === INDEX_VERSION &&
        parsed.revision === revision &&
        parsed.projectRoot === await fs.realpath(projectPath) &&
        Array.isArray(parsed.entries) &&
        Array.isArray(parsed.directories) &&
        await directoryStructureMatches(projectPath, parsed.directories)
      ) return { index: parsed, rebuilt: false };
    } catch { /* rebuild */ }
  }
  const index = await buildIndex(projectPath, revision);
  await atomicWrite(file, index);
  return { index, rebuilt: true };
}


export async function candidateEntriesFromSeed(projectPath: string, seedPaths: string[]): Promise<CandidateEntry[]> {
  const root = await fs.realpath(projectPath);
  const out: CandidateEntry[] = [];
  for (const relRaw of seedPaths.slice(0, 64)) {
    const rel = relRaw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || rel.startsWith("../") || path.isAbsolute(rel) || ignoredFile(path.basename(rel), rel)) continue;
    const absolute = path.resolve(root, rel);
    const real = await fs.realpath(absolute).catch(() => "");
    if (!real || (real !== root && !real.startsWith(root + path.sep))) continue;
    const handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
    if (!handle) continue;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) continue;
      out.push({ path: rel, kind: path.basename(rel) === "SKILL.md" ? "skill" : "path", size: stat.size });
    } finally {
      await handle.close();
    }
  }
  return out;
}
