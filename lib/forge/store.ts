import { readBoundedRegularBufferOrThrow } from "@/lib/host/bounded-read";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { ForgeCandidate, PublicForgeCandidate } from "./types";

const ID_RE = /^forge_[0-9]{8}_[0-9]{6}_[a-f0-9]{12}$/;

function forgeRoot(): string {
  const raw = process.env.OS_TOOL_FORGE_DIR?.trim();
  return path.resolve((raw || path.join(os.homedir(), ".mso", "tool-forge")).replace(/^~(?=$|\/)/, os.homedir()));
}

function candidatesDir(): string { return path.join(forgeRoot(), "candidates"); }
function candidatePath(id: string): string {
  if (!ID_RE.test(id)) throw new Error("invalid forge candidate id");
  return path.join(candidatesDir(), `${id}.json`);
}

export function forgeOwnerHash(owner: string): string {
  return createHash("sha256").update(owner).digest("hex");
}

export function newForgeCandidateId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  return `forge_${stamp}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function ensureRoot(): Promise<void> {
  await fs.mkdir(candidatesDir(), { recursive: true, mode: 0o700 });
  await fs.chmod(forgeRoot(), 0o700).catch(() => undefined);
  await fs.chmod(candidatesDir(), 0o700).catch(() => undefined);
}

async function readCandidateFile(file: string): Promise<ForgeCandidate | null> {
  try {
    const data = await readBoundedRegularBufferOrThrow(file, 256 * 1024);
    if (!data.length) throw new Error("invalid forge candidate file");
    return JSON.parse(data.toString("utf8")) as ForgeCandidate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("invalid forge candidate file", { cause: error });
  }
}

async function writeCandidateFile(file: string, candidate: ForgeCandidate): Promise<void> {
  await ensureRoot();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
}

export async function createForgeCandidate(candidate: ForgeCandidate): Promise<ForgeCandidate> {
  await ensureRoot();
  const file = candidatePath(candidate.id);
  const exists = await fs.lstat(file).catch(() => null);
  if (exists) throw new Error("forge candidate id collision");
  await writeCandidateFile(file, candidate);
  return candidate;
}

export async function getForgeCandidate(id: string, owner: string): Promise<ForgeCandidate | null> {
  const row = await readCandidateFile(candidatePath(id));
  if (!row) return null;
  if (row.ownerHash !== forgeOwnerHash(owner)) return null;
  return row;
}

export async function listForgeCandidates(owner: string): Promise<ForgeCandidate[]> {
  await ensureRoot();
  const ownerHash = forgeOwnerHash(owner);
  const names = await fs.readdir(candidatesDir()).catch(() => [] as string[]);
  const rows: ForgeCandidate[] = [];
  for (const name of names.sort()) {
    if (!/^forge_[0-9]{8}_[0-9]{6}_[a-f0-9]{12}\.json$/.test(name)) continue;
    const row = await readCandidateFile(path.join(candidatesDir(), name)).catch(() => null);
    if (row?.ownerHash === ownerHash) rows.push(row);
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateForgeCandidate(
  id: string,
  owner: string,
  mutate: (candidate: ForgeCandidate) => ForgeCandidate | Promise<ForgeCandidate>,
): Promise<ForgeCandidate> {
  const file = candidatePath(id);
  return withSecurityStoreLock(file, async () => {
    const current = await readCandidateFile(file);
    if (!current || current.ownerHash !== forgeOwnerHash(owner)) throw new Error("forge candidate not found");
    const next = await mutate(current);
    await writeCandidateFile(file, next);
    return next;
  });
}

export function publicForgeCandidate(candidate: ForgeCandidate): PublicForgeCandidate {
  const { ownerHash: _ownerHash, function: fn, ...rest } = candidate;
  return {
    ...rest,
    recipe: { ...rest.recipe, bestSteps: rest.recipe.bestSteps.map(({ tool, state }) => ({ tool, state })) },
    ...(fn ? {
      function: {
        name: fn.name,
        description: fn.description,
        inputSchema: fn.inputSchema,
        timeoutMs: fn.timeoutMs,
        fixtureCount: fn.fixtures.length,
        command: fn.command.length ? { executable: path.basename(fn.command[0]!), argvCount: fn.command.length } : undefined,
      },
    } : {}),
  };
}

export function resetForgeStoreForTests(): void {
  // Store is intentionally file-backed with no module cache. Kept for symmetry and future migrations.
}
