import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { appDir, homeDir, isUnderRoot, resolveReadable } from "@/lib/host/paths";
import { makeDir, writeFile } from "@/lib/host/fs";
import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import type { AgentVaultState } from "@/lib/contracts/agent-vault";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);
const MAX_MANIFEST = 1024 * 1024;
export function vaultDirectory(project: AgentVaultState["project"]): string {
  const configured = process.env.OS_AGENT_VAULT_ROOT?.trim();
  const base = configured?.startsWith("~/") ? path.join(homeDir(), configured.slice(2)) : configured || path.join(homeDir(), "mso-vaults");
  const slug = project.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "project";
  const root = path.resolve(base, `${slug}-${digest(project.id)}`);
  if (isUnderRoot(root, project.path) || isUnderRoot(project.path, root)) throw new Error("Vault data must be outside the source repository");
  if (isUnderRoot(root, appDir())) throw new Error("Vault user data must be outside the MSO source checkout");
  return root;
}
export function emptyState(project: AgentVaultState["project"]): AgentVaultState {
  return { schemaVersion: 1, project, root: vaultDirectory(project), current: null, snapshots: [], refreshedAt: null };
}
async function exactReadable(file: string): Promise<string> {
  const real = await resolveReadable(file);
  if (real !== path.resolve(file)) throw new Error("Vault symlinks are not supported");
  return real;
}
export async function loadVaultState(project: AgentVaultState["project"]): Promise<AgentVaultState> {
  const empty = emptyState(project), file = path.join(empty.root, "manifest.json");
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat) return empty;
  const body = await readBoundedRegularFile(await exactReadable(file), MAX_MANIFEST);
  if (body === null) throw new Error("Vault manifest is unreadable or oversized");
  const state = JSON.parse(body) as AgentVaultState;
  if (state.schemaVersion !== 1 || state.project?.id !== project.id || state.root !== empty.root || !Array.isArray(state.snapshots) || state.snapshots.length > 20) throw new Error("Invalid vault manifest");
  for (const snapshot of state.snapshots) {
    if (!/^[a-f0-9]{20}$/.test(snapshot.id) || !Array.isArray(snapshot.notes) || snapshot.notes.length > 125 || !Array.isArray(snapshot.warnings)) throw new Error("Invalid vault snapshot");
    for (const note of snapshot.notes) {
      if (typeof note.path !== "string" || !note.path.startsWith(`Snapshots/${snapshot.id}/`) || !/^Snapshots\/[a-f0-9]{20}\/(?:overview|agent|project|progress|inbox|memory)\/[a-zA-Z0-9_-]+\.md$/.test(note.path)) throw new Error("Invalid vault note path");
    }
  }
  return state;
}
export async function readVaultNote(state: AgentVaultState, note: string): Promise<string> {
  if (!state.snapshots.some(s => s.notes.some(n => n.path === note))) throw new Error("Note is not part of this repository vault");
  const file = path.join(state.root, note);
  const body = await readBoundedRegularFile(await exactReadable(file), 64 * 1024);
  if (body === null) throw new Error("Vault note is unreadable or oversized");
  return body;
}
export async function writeVaultArtifact(root: string, relative: string, body: string): Promise<void> {
  const file = path.join(root, relative);
  if (!isUnderRoot(file, root) || file === root || Buffer.byteLength(body) > 1024 * 1024) throw new Error("Invalid vault artifact");
  await makeDir(path.dirname(file));
  await exactReadable(path.dirname(file));
  await writeFile(file, body);
}
