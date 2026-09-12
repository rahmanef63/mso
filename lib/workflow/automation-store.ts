import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { agentSessionsDir } from "@/lib/agent/session-paths";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { FlowRun } from "@/lib/contracts/automation";

export const flowHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const flowOwner = (principal: string) => flowHash(principal);
const ROOT = () => path.join(agentSessionsDir(), ".flow-runs");
function file(owner: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-f0-9]{32}$/.test(id)) throw new Error("invalid flow run identity");
  return path.join(ROOT(), owner, id + ".json");
}
export async function readFlowRun(owner: string, id: string): Promise<FlowRun | null> {
  const pinned = await pinSecurityStorePath(file(owner, id));
  let handle;
  try {
    handle = await fs.open(pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 256 * 1024 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error("unsafe flow run");
    const run = JSON.parse(await handle.readFile("utf8")) as FlowRun;
    if (run.version !== 1 || run.owner !== owner || run.id !== id || !Array.isArray(run.steps)) throw new Error("invalid flow run");
    return run;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  finally { await handle?.close(); await pinned.directory.close(); }
}
export async function writeFlowRun(run: FlowRun) {
  const pinned = await pinSecurityStorePath(file(run.owner, run.id)), tmp = pinned.file + "." + randomUUID() + ".tmp";
  try {
    const text = JSON.stringify(run);
    if (Buffer.byteLength(text) > 256 * 1024) throw new Error("flow receipt exceeds 256 KiB");
    await fs.writeFile(tmp, text, { flag: "wx", mode: 0o600 });
    await fs.rename(tmp, pinned.file);
  } finally { await fs.unlink(tmp).catch(() => undefined); await pinned.directory.close(); }
}
export function lockFlowRun<T>(owner: string, id: string, fn: () => Promise<T>) {
  return withSecurityStoreLock(file(owner, id), fn);
}
export function lockFlowOwner<T>(owner: string, fn: () => Promise<T>) {
  return withSecurityStoreLock(path.join(ROOT(), owner, ".quota"), fn);
}
export async function pruneFlowReceipts(owner: string) {
  const directory = path.join(ROOT(), owner), entries = await fs.readdir(directory);
  let retained = 0, running = 0;
  for (const entry of entries) {
    const id = entry.replace(/\.json$/, "");
    if (!/^[a-f0-9]{32}$/.test(id)) continue;
    const run = await readFlowRun(owner, id);
    if (!run) continue;
    if (run.state === "running") {
      let gone = false;
      try { process.kill(run.pid, 0); } catch (e) { gone = (e as NodeJS.ErrnoException).code === "ESRCH"; }
      if (gone) { run.state = "interrupted"; run.finishedAt = run.updatedAt = new Date().toISOString(); await writeFlowRun(run); }
    }
    if (run.state !== "running" && Date.now() - Date.parse(run.updatedAt) > 30 * 86400_000) {
      const pinned = await pinSecurityStorePath(file(owner, id));
      try { await fs.unlink(pinned.file); } finally { await pinned.directory.close(); }
    } else { retained++; if (run.state === "running") running++; }
  }
  // ponytail: per-owner quota bounds normal storage to 1,000 receipts; index if this measured scan becomes material.
  if (retained >= 1000 || running >= 4) throw new Error("flow capacity reached (1,000 receipts / 4 running per owner)");
}
export function publicFlowRun({ owner: _owner, fingerprint: _fingerprint, pid: _pid, instance: _instance, ...run }: FlowRun) {
  return { ...run, pollAfterMs: run.state === "running" ? 2000 : 0,
    ...(run.state === "interrupted" ? { nextAction: "Inspect the provider outcome; never replay an uncertain mutation automatically." } : {}) };
}
