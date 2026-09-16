import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { normalizeRecipes } from "./sanitize";
import { workflowStorePath } from "./storage";
import type { LearnedRecipe, RecipeAccess } from "./types";
import { allows } from "@/lib/capabilities/scope";

const SEGMENT_RE = /^segment-[a-f0-9]{32}\.json$/;
const MAX_SEGMENT_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVED_RECIPES = 5000;

type Segment = { schemaVersion: 1; archivedAt: string; recipes: Record<string, LearnedRecipe> };
function archiveDir(): string { return `${workflowStorePath()}.archive-v1`; }
function body(recipes: LearnedRecipe[], archivedAt: string): string {
  return JSON.stringify({ schemaVersion: 1, archivedAt, recipes: Object.fromEntries(recipes.map((recipe) => [recipe.id, recipe])) } satisfies Segment);
}
async function secureDir(): Promise<string> {
  const dir = archiveDir(); await fs.mkdir(dir, { recursive: true, mode: 0o700 }); await fs.chmod(dir, 0o700).catch(() => undefined);
  const stat = await fs.lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("unsafe workflow recipe archive directory");
  return dir;
}
async function readSegment(file: string): Promise<Segment> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW); const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SEGMENT_BYTES || (stat.mode & 0o077) || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("workflow recipe archive segment has an invalid file shape");
    const parsed = JSON.parse(await handle.readFile("utf8")) as Partial<Segment>;
    if (parsed.schemaVersion !== 1 || typeof parsed.archivedAt !== "string" || !Number.isFinite(Date.parse(parsed.archivedAt)) || !parsed.recipes || typeof parsed.recipes !== "object") throw new Error("workflow recipe archive segment has an invalid schema");
    const recipes = normalizeRecipes(parsed.recipes);
    return { schemaVersion: 1, archivedAt: new Date(parsed.archivedAt).toISOString(), recipes };
  } finally { await handle?.close().catch(() => undefined); }
}

export async function archiveLearnedRecipes(recipes: LearnedRecipe[]): Promise<{ recipes: number; segment?: string }> {
  if (!recipes.length) return { recipes: 0 };
  const archivedAt = new Date().toISOString(), snapshot = body(recipes, archivedAt);
  if (Buffer.byteLength(snapshot) > MAX_SEGMENT_BYTES) throw new Error("workflow recipe archive segment exceeds 2 MiB");
  const dir = await secureDir(), digest = createHash("sha256").update(snapshot).digest("hex").slice(0, 32), name = `segment-${digest}.json`, file = path.join(dir, name);
  try { const existing = await readSegment(file); if (Object.keys(existing.recipes).length === recipes.length) return { recipes: recipes.length, segment: name }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, snapshot, { flag: "wx", mode: 0o600 }); await fs.rename(tmp, file); await fs.chmod(file, 0o600); }
  finally { await fs.unlink(tmp).catch(() => undefined); }
  return { recipes: recipes.length, segment: name };
}

export async function listArchivedLearnedRecipes(access: RecipeAccess): Promise<LearnedRecipe[]> {
  let names: string[]; try { names = (await fs.readdir(archiveDir())).filter((name) => SEGMENT_RE.test(name)).sort().reverse().slice(0, 4096); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const byId = new Map<string, LearnedRecipe>();
  for (const name of names) {
    const segment = await readSegment(path.join(archiveDir(), name));
    for (const recipe of Object.values(segment.recipes)) {
      const visible = access.ownerView || (recipe.actor === access.actor && allows(access.scope, recipe.scope));
      if (!visible) continue;
      const prior = byId.get(recipe.id); if (!prior || Date.parse(recipe.updatedAt) > Date.parse(prior.updatedAt)) byId.set(recipe.id, recipe);
      if (byId.size > MAX_ARCHIVED_RECIPES) throw new Error(`workflow recipe archive exceeds explicit retrieval limit of ${MAX_ARCHIVED_RECIPES}`);
    }
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
