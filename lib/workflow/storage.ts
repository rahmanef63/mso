// One runtime process owns this in-memory store; active checkpoints avoid rewriting recipes.
import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { normalizeActive, normalizeRecipes } from "./sanitize";
import type { WorkflowStoreState } from "./types";
const EMPTY = (): WorkflowStoreState => ({ version: 3, active: {}, recipes: {} });
let cache: WorkflowStoreState | null = null, cachePath = "", baseSnapshot = "";
let needsMigration = false;
const loadInFlight = new Map<string, Promise<WorkflowStoreState>>();
let writeChain: Promise<unknown> = Promise.resolve();
function storePath(): string {
  const env = process.env.OS_SKILL_MEMORY_STORE?.trim();
  if (process.env.VITEST && !env) return path.join(os.tmpdir(), `mso-skill-memory-test-${process.pid}.json`);
  return (env || path.join(os.homedir(), ".mso", "skill-memory.json")).replace(/^~(?=$|\/)/, os.homedir());
}
function legacySnapshot(raw: string) { return "legacy:" + createHash("sha256").update(raw).digest("hex"); }
/** The base file remains a complete version-3 snapshot. Matching sidecar supersedes only active state. */
export async function loadWorkflowStore(): Promise<WorkflowStoreState> {
  const file = storePath();
  if (cache && cachePath === file) return cache;
  const current = loadInFlight.get(file); if (current) return current;
  const pending = (async () => {
    let raw: string;
    try { raw = await fs.readFile(/* turbopackIgnore: true */ file, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      cache = EMPTY(); cachePath = file; baseSnapshot = ""; return cache;
    }
    const parsed = JSON.parse(raw) as { active?: unknown; recipes?: unknown; snapshotId?: string; version?: number };
    baseSnapshot = parsed.snapshotId ?? legacySnapshot(raw); needsMigration = parsed.version !== 3;
    cache = { version: 3, active: normalizeActive(parsed.active), recipes: normalizeRecipes(parsed.recipes) };
    try {
      const overlay = JSON.parse(await fs.readFile(/* turbopackIgnore: true */ file + ".active.json", "utf8"));
      if (overlay.version === 1 && overlay.baseSnapshot === baseSnapshot) cache.active = normalizeActive(overlay.active);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    cachePath = file; return cache;
  })();
  loadInFlight.set(file, pending);
  try { return await pending; } finally { if (loadInFlight.get(file) === pending) loadInFlight.delete(file); }
}
async function atomic(file: string, snapshot: string) {
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } finally { await fs.unlink(tmp).catch(() => undefined); }
}
export async function persistWorkflowStore(store: WorkflowStoreState, activeOnly = false): Promise<void> {
  const file = storePath(), partial = activeOnly && Boolean(baseSnapshot) && !needsMigration;
  // Capture bytes now, before callers mutate the shared object again.
  if (!partial) { baseSnapshot = randomUUID(); needsMigration = false; }
  const snapshot = partial ? JSON.stringify({ version: 1, baseSnapshot, active: store.active }) : JSON.stringify({ ...store, snapshotId: baseSnapshot });
  const run = writeChain.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await atomic(partial ? file + ".active.json" : file, snapshot);
    if (!partial) await fs.unlink(file + ".active.json").catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
  });
  writeChain = run.catch(() => undefined); await run;
}
/** Test-only cache reset. */
export function resetWorkflowStoreCache(): void {
  cache = null; cachePath = ""; baseSnapshot = ""; loadInFlight.clear(); writeChain = Promise.resolve();
}
