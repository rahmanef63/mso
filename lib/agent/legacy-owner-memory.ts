import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Durable cross-session facts recalled into Alfa's system prompt. One JSON file in
// ~/.mso (small structured records, chmod 600). Recall is substring scoring for
// now. ponytail: substring recall — swap for embeddings if it gets noisy at scale.
export interface Memory {
  id: string;
  text: string;
  createdAt: number;
}

const FILE = process.env.OS_MEMORY_STORE || path.join(os.homedir(), ".mso", "memory.json");

async function read(): Promise<Memory[]> {
  try {
    const j = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function write(list: Memory[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, FILE);
}

export async function listMemories(): Promise<Memory[]> {
  return (await read()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function addMemory(text: string): Promise<Memory> {
  const m: Memory = { id: `mem_${Date.now().toString(36)}`, text: text.trim().slice(0, 500), createdAt: Date.now() };
  const list = await read();
  list.push(m);
  await write(list);
  return m;
}

export async function removeMemory(id: string): Promise<void> {
  await write((await read()).filter((m) => m.id !== id));
}

// Recall facts relevant to `query` (scored by how many of its ≥3-char words appear),
// capped. No query signal → the most recent facts.
export async function recall(query: string, limit = 8): Promise<Memory[]> {
  const all = await read();
  if (all.length === 0) return [];
  const words = query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  if (words.length === 0) return all.slice(-limit);
  return all
    .map((m) => ({ m, hits: words.filter((w) => m.text.toLowerCase().includes(w)).length }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((s) => s.m);
}
