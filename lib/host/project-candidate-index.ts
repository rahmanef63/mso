import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readBoundedRegularFile } from "./bounded-read";
import { candidateEntriesFromSeed, loadCandidateIndex, type CandidateEntry } from "./project-candidate-index-cache";

const MAX_CONTENT_BYTES = 128 * 1024;
const MAX_MATCHES = 16;

export type ProjectCandidate = CandidateEntry & { score: number };
export type ProjectCandidateMatch = { path: string; line: number; preview: string };

export function projectCandidateRevision(repository: {
  git?: { head?: { sha?: string }; branch?: string; changes?: unknown[] };
} | undefined): string {
  return createHash("sha256").update(JSON.stringify({
    head: repository?.git?.head?.sha ?? null,
    branch: repository?.git?.branch ?? null,
    changes: repository?.git?.changes ?? [],
  })).digest("hex");
}
function queryTokens(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9_.@/-]+/).filter((token) => token.length >= 2))].slice(0, 32);
}

function rank(entry: CandidateEntry, tokens: string[]): number {
  const value = entry.path.toLowerCase();
  const base = path.basename(value);
  let score = entry.kind === "skill" ? 0.08 : 0;
  for (const token of tokens) {
    if (base === token) score += 0.65;
    else if (base.includes(token)) score += 0.36;
    else if (value.includes(token)) score += 0.18;
  }
  return Math.round(Math.min(1, score) * 1000) / 1000;
}

function cursorHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function encodeCursor(revision: string, query: string, offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, r: cursorHash(revision), q: cursorHash(query), o: offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined, revision: string, query: string): number {
  if (!cursor) return 0;
  if (cursor.length > 512) throw new Error("candidate cursor is too large");
  try {
    const row = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: number; r?: string; q?: string; o?: number };
    if (row.v !== 1 || row.r !== cursorHash(revision) || row.q !== cursorHash(query) || !Number.isSafeInteger(row.o) || Number(row.o) < 0)
      throw new Error("candidate cursor does not match this project revision/query");
    return Number(row.o);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("candidate cursor")) throw error;
    throw new Error("invalid candidate cursor");
  }
}

async function contentMatches(projectPath: string, candidates: ProjectCandidate[], query: string): Promise<ProjectCandidateMatch[]> {
  const root = await fs.realpath(projectPath);
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const matches: ProjectCandidateMatch[] = [];
  for (const candidate of candidates) {
    if (matches.length >= MAX_MATCHES) break;
    const absolute = path.resolve(root, candidate.path);
    const real = await fs.realpath(absolute).catch(() => "");
    if (!real || (real !== root && !real.startsWith(root + path.sep))) continue;
    const content = await readBoundedRegularFile(real, MAX_CONTENT_BYTES);
    if (content == null || content.includes("\u0000")) continue;
    const lines = content.split(/\r?\n/);
    let perFile = 0;
    for (let index = 0; index < lines.length && perFile < 3 && matches.length < MAX_MATCHES; index += 1) {
      const lower = lines[index].toLowerCase();
      if (!tokens.some((token) => lower.includes(token))) continue;
      const preview = lines[index].trim().replace(/\s+/g, " ").slice(0, 220);
      if (!preview) continue;
      matches.push({ path: candidate.path, line: index + 1, preview });
      perFile += 1;
    }
  }
  return matches;
}

export async function searchProjectCandidateIndex(input: {
  projectPath: string;
  query: string;
  revision: string;
  limit?: number;
  cursor?: string;
  seedPaths?: string[];
  reuseOnly?: boolean;
}): Promise<{
  revision: string;
  rebuilt: boolean;
  reusedSeed: boolean;
  indexedEntries: number;
  candidates: ProjectCandidate[];
  matches: ProjectCandidateMatch[];
  truncated: boolean;
  truncationReasons: string[];
  cursor?: string;
}> {
  const limit = Math.min(Math.max(Math.round(input.limit ?? 16), 1), 40);
  const query = input.query.slice(0, 4096);
  const reuseOnly = input.reuseOnly === true;
  const seeded = input.seedPaths?.length ? await candidateEntriesFromSeed(input.projectPath, input.seedPaths) : [];
  const loaded = reuseOnly
    ? { index: { version: 1 as const, projectRoot: await fs.realpath(input.projectPath), revision: input.revision, entries: seeded, directories: [], truncated: false, truncationReasons: [], createdAt: new Date().toISOString() }, rebuilt: false }
    : await loadCandidateIndex(input.projectPath, input.revision);
  const source = reuseOnly ? seeded : loaded.index.entries;
  const tokens = queryTokens(query);
  const ranked = source
    .map((entry) => ({ ...entry, score: rank(entry, tokens) }))
    .filter((entry) => reuseOnly || tokens.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const offset = decodeCursor(input.cursor, input.revision, query);
  const candidates = ranked.slice(offset, offset + limit);
  const matches = await contentMatches(input.projectPath, candidates, query);
  const hasMore = offset + candidates.length < ranked.length;
  const truncated = loaded.index.truncated || hasMore;
  const truncationReasons = [...loaded.index.truncationReasons, ...(hasMore ? ["page"] : [])];
  return {
    revision: input.revision,
    rebuilt: loaded.rebuilt,
    reusedSeed: reuseOnly,
    indexedEntries: source.length,
    candidates,
    matches,
    truncated,
    truncationReasons: [...new Set(truncationReasons)],
    ...(hasMore ? { cursor: encodeCursor(input.revision, query, offset + candidates.length) } : {}),
  };
}
