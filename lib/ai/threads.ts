import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";

// Persistent Alfa chat threads — one YAML file per thread under ~/.mso/threads/.
// YAML (not JSON) so the session files stay human-readable (owner's call). `messages`
// = the display bubbles; `history` = the wire turns needed to CONTINUE the chat.
// Both are opaque to the server (stored/restored verbatim); the client owns the shape.
export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: unknown[];
  history: unknown[];
}

export type ThreadSummary = Pick<ChatThread, "id" | "title" | "createdAt" | "updatedAt">;

const DIR = process.env.OS_THREADS_DIR || path.join(os.homedir(), ".mso", "threads");
// ids are app-generated but jail them anyway (path-traversal guard): alnum + -_ only.
const safeId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("invalid thread id");
  return id;
};
const fileFor = (id: string) => path.join(DIR, `${safeId(id)}.yml`);

export async function listThreads(): Promise<ThreadSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(DIR);
  } catch {
    return [];
  }
  const out: ThreadSummary[] = [];
  for (const n of names) {
    if (!n.endsWith(".yml")) continue;
    try {
      const t = parse(await fs.readFile(path.join(DIR, n), "utf8")) as ChatThread;
      if (t?.id) out.push({ id: t.id, title: t.title || "Untitled", createdAt: t.createdAt || 0, updatedAt: t.updatedAt || 0 });
    } catch {
      /* skip corrupt file */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getThread(id: string): Promise<ChatThread | null> {
  const file = fileFor(id); // validate before the not-found/corrupt-file catch
  try {
    return parse(await fs.readFile(file, "utf8")) as ChatThread;
  } catch {
    return null;
  }
}

export async function saveThread(t: ChatThread): Promise<void> {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  const dest = fileFor(t.id);
  const tmp = `${dest}.tmp`;
  await fs.writeFile(tmp, stringify(t), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, dest);
}

export async function deleteThread(id: string): Promise<void> {
  const file = fileFor(id); // invalid ids are authorization/input errors, not "already gone"
  try {
    await fs.unlink(file);
  } catch {
    /* already gone */
  }
}
