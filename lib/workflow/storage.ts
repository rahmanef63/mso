import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeActive, normalizeRecipes } from "./sanitize";
import type { WorkflowStoreState } from "./types";

const EMPTY = (): WorkflowStoreState => ({ version: 3, active: {}, recipes: {} });
let cache: WorkflowStoreState | null = null;
let cachePath = "";
const loadInFlight = new Map<string, Promise<WorkflowStoreState>>();
let writeChain: Promise<unknown> = Promise.resolve();

function storePath(): string {
  const env = process.env.OS_SKILL_MEMORY_STORE?.trim();
  if (process.env.VITEST && !env) return path.join(os.tmpdir(), `mso-skill-memory-test-${process.pid}.json`);
  return (env || path.join(os.homedir(), ".mso", "skill-memory.json")).replace(/^~(?=$|\/)/, os.homedir());
}

/** The only module that reads/writes the workflow/recipe persistence file. */
export async function loadWorkflowStore(): Promise<WorkflowStoreState> {
  const file = storePath();
  if (cache && cachePath === file) return cache;
  const current = loadInFlight.get(file);
  if (current) return current;

  const pending = (async () => {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        cache = EMPTY();
        cachePath = file;
        return cache;
      }
      throw error;
    }
    const parsed = JSON.parse(raw) as { active?: unknown; recipes?: unknown };
    cache = { version: 3, active: normalizeActive(parsed.active), recipes: normalizeRecipes(parsed.recipes) };
    cachePath = file;
    return cache;
  })();
  loadInFlight.set(file, pending);
  try {
    return await pending;
  } finally {
    if (loadInFlight.get(file) === pending) loadInFlight.delete(file);
  }
}

export async function persistWorkflowStore(store: WorkflowStoreState): Promise<void> {
  const file = storePath();
  const snapshot = JSON.stringify(store, null, 2);
  const run = writeChain.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, snapshot, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, file);
  });
  writeChain = run.catch(() => undefined);
  await run;
}

/** Test-only cache reset; public compatibility maps the historical name. */
export function resetWorkflowStoreCache(): void {
  cache = null;
  cachePath = "";
  loadInFlight.clear();
  writeChain = Promise.resolve();
}
