import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  atomicWriteJson,
  ensureRepoMemoryLayout,
  existingRepoMemoryLayout,
  MAX_RECORD_BYTES,
  projectRoot,
  safeArtifactId,
} from "./repo-memory-storage";
import type { AutomationScriptManifest, EvidenceReceipt } from "./types";

export async function writeEvidenceReceipt(projectPath: string, receipt: EvidenceReceipt): Promise<string> {
  const agent = await ensureRepoMemoryLayout(projectPath);
  const file = path.join(agent, "evidence", `${receipt.createdAt.slice(0, 10)}-${receipt.workflow}.json`);
  await atomicWriteJson(file, receipt);
  return path.relative(await projectRoot(projectPath), file);
}

export async function writePortableRecipe(projectPath: string, recipe: unknown, id: string): Promise<string> {
  const agent = await ensureRepoMemoryLayout(projectPath);
  const file = path.join(agent, "recipes", `${safeArtifactId(id)}.json`);
  await atomicWriteJson(file, recipe);
  return path.relative(await projectRoot(projectPath), file);
}

export async function writeAutomationScript(projectPath: string, script: unknown, id: string, candidate = true): Promise<string> {
  const agent = await ensureRepoMemoryLayout(projectPath);
  const safeId = safeArtifactId(id);
  const suffix = candidate ? ".candidate.json" : ".json";
  const file = path.join(agent, "scripts", `${safeId}${suffix}`);
  await atomicWriteJson(file, script);
  if (!candidate) await fs.rm(path.join(agent, "scripts", `${safeId}.candidate.json`), { force: true }).catch(() => undefined);
  return path.relative(await projectRoot(projectPath), file);
}

export async function readAutomationScript(projectPath: string, id: string): Promise<AutomationScriptManifest | null> {
  const agent = await existingRepoMemoryLayout(projectPath);
  if (!agent) return null;
  const safeId = safeArtifactId(id);
  for (const name of [`${safeId}.json`, `${safeId}.candidate.json`]) {
    const file = path.join(agent, "scripts", name);
    const raw = await readBoundedRegularFile(file, MAX_RECORD_BYTES);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as AutomationScriptManifest;
      if (parsed?.schemaVersion !== 1 || parsed.id !== id || !Array.isArray(parsed.steps) || !parsed.steps.length) continue;
      if (parsed.status !== "candidate" && parsed.status !== "tested") continue;
      return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

export async function listAutomationScripts(projectPath: string, limit = 200): Promise<AutomationScriptManifest[]> {
  const agent = await existingRepoMemoryLayout(projectPath);
  if (!agent) return [];
  const dir = path.join(agent, "scripts");
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const ids = new Set<string>();
  for (const name of names.slice(0, Math.max(1, Math.min(500, limit * 3)))) {
    const id = name.endsWith(".candidate.json") ? name.slice(0, -".candidate.json".length) : name.endsWith(".json") ? name.slice(0, -".json".length) : "";
    if (id) ids.add(id);
    if (ids.size >= limit) break;
  }
  const rows = (await Promise.all([...ids].map((id) => readAutomationScript(projectPath, id)))).filter((row): row is AutomationScriptManifest => Boolean(row));
  return rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
