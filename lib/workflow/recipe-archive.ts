import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeRecipes } from "./sanitize";
import { workflowStorePath } from "./storage";
import type { LearnedRecipe, RecipeAccess } from "./types";
import { allows } from "@/lib/capabilities/scope";

import { listWorkflowFiles, readWorkflowJson, writeWorkflowFile } from "./private-file";

const SEGMENT_RE = /^segment-[a-f0-9]{32}\.json$/;
const MAX_SEGMENT_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVED_RECIPES = 5000;

type Segment = { schemaVersion: 1; archivedAt: string; recipes: Record<string, LearnedRecipe> };
function archiveDir(): string { return `${workflowStorePath()}.archive-v1`; }
function body(recipes: LearnedRecipe[], archivedAt: string): string {
  return JSON.stringify({ schemaVersion: 1, archivedAt, recipes: Object.fromEntries(recipes.map((recipe) => [recipe.id, recipe])) } satisfies Segment);
}
async function readSegment(file: string): Promise<Segment> {
  const parsed = await readWorkflowJson(file, MAX_SEGMENT_BYTES, "workflow recipe archive segment") as Partial<Segment>;
  if (parsed.schemaVersion !== 1 || typeof parsed.archivedAt !== "string" || !Number.isFinite(Date.parse(parsed.archivedAt)) || !parsed.recipes || typeof parsed.recipes !== "object") throw new Error("workflow recipe archive segment has an invalid schema");
  const recipes = normalizeRecipes(parsed.recipes);
  return { schemaVersion: 1, archivedAt: new Date(parsed.archivedAt).toISOString(), recipes };
}

export async function archiveLearnedRecipes(recipes: LearnedRecipe[]): Promise<{ recipes: number; segment?: string }> {
  if (!recipes.length) return { recipes: 0 };
  const archivedAt = new Date().toISOString(), snapshot = body(recipes, archivedAt);
  if (Buffer.byteLength(snapshot) > MAX_SEGMENT_BYTES) throw new Error("workflow recipe archive segment exceeds 2 MiB");
  const dir = archiveDir(), digest = createHash("sha256").update(snapshot).digest("hex").slice(0, 32), name = `segment-${digest}.json`, file = path.join(dir, name);
  try { const existing = await readSegment(file); if (Object.keys(existing.recipes).length === recipes.length) return { recipes: recipes.length, segment: name }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeWorkflowFile(file, snapshot);
  return { recipes: recipes.length, segment: name };
}

export async function listArchivedLearnedRecipes(access: RecipeAccess): Promise<LearnedRecipe[]> {
  let names: string[]; try { names = (await listWorkflowFiles(archiveDir())).filter((name) => SEGMENT_RE.test(name)).sort().reverse().slice(0, 4096); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const byId = new Map<string, LearnedRecipe>();
  for (const name of names) {
    const segment = await readSegment(path.join(archiveDir(), path.basename(name)));
    for (const recipe of Object.values(segment.recipes)) {
      const visible = access.ownerView || (recipe.actor === access.actor && allows(access.scope, recipe.scope));
      if (!visible) continue;
      const prior = byId.get(recipe.id); if (!prior || Date.parse(recipe.updatedAt) > Date.parse(prior.updatedAt)) byId.set(recipe.id, recipe);
      if (byId.size > MAX_ARCHIVED_RECIPES) throw new Error(`workflow recipe archive exceeds explicit retrieval limit of ${MAX_ARCHIVED_RECIPES}`);
    }
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
