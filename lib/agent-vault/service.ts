import path from "node:path";
import { redactText } from "@/lib/orchestration/redaction";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { makeDir } from "@/lib/host/fs";
import { resolveReadable } from "@/lib/host/paths";
import { resolveProjectHint } from "@/lib/host/projects-api";
import type { AgentVaultView, AgentVaultNote, AgentVaultSnapshot } from "@/lib/contracts/agent-vault";
import { collectVaultSources, type VaultSource } from "./sources";
import { digest, emptyState, loadVaultState, readVaultNote, writeVaultArtifact } from "./store";

const active = new Set<string>();
async function projectFor(hint?: string) {
  const selected = hint?.trim() || process.env.OS_AGENT_VAULT_PROJECT?.trim() || "";
  if (!selected || selected.length > 500) throw new Error("Select a repository id, name or path");
  const project = await resolveProjectHint(selected);
  if (!project) throw new Error("Repository not found within configured project roots");
  return { id: project.id, name: project.name, path: project.path };
}
export async function getAgentVault(project?: string, note?: string): Promise<AgentVaultView> {
  const state = await loadVaultState(await projectFor(project));
  return { state, ...(note ? { note: { path: note, content: await readVaultNote(state, note) } } : {}) };
}
function noteBody(source: VaultSource, project: string, sources: VaultSource[]): string {
  const targets = new Map(sources.map(s => [s.source, s.key]));
  const content = source.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (original, label: string, href: string) => {
    if (/^(?:[a-z]+:|\/|#)/i.test(href)) return original;
    const [file, anchor] = href.split("#");
    if (!file.endsWith(".md")) return original;
    const target = targets.get(path.posix.normalize(path.posix.join(path.posix.dirname(source.source), file)));
    return target ? `[${label}](${path.posix.relative(path.posix.dirname(source.key), target)}${anchor ? `#${anchor}` : ""})` : `${label} (source: ${href})`;
  });
  return `---\ntype: ${source.kind}\nsource: ${JSON.stringify(redactText(source.source, 400))}\nrepository: ${JSON.stringify(project)}\ngenerated: true\n---\n\n> Repository projection. The source remains authoritative; this snapshot is not live agent status.\n\n${content}\n`;
}
export async function syncAgentVault(hint?: string): Promise<AgentVaultView & { changed: boolean }> {
  const project = await projectFor(hint);
  if (active.has(project.id)) throw new Error("This repository vault is already refreshing");
  if (active.size >= 2) throw new Error("Vault refresh capacity reached");
  active.add(project.id);
  try {
    const root = emptyState(project).root;
    await makeDir(root);
    if (await resolveReadable(root) !== root) throw new Error("Vault symlinks are not supported");
    return await withSecurityStoreLock(path.join(root, "manifest.json"), async () => {
      const state = await loadVaultState(project);
      const collected = await collectVaultSources(project);
      const id = digest(JSON.stringify({ formatVersion: 1, ...collected }));
      const now = new Date().toISOString();
      if (state.current === id) return { state, changed: false };
      const existing = state.snapshots.find(s => s.id === id);
      if (!existing && state.snapshots.length >= 20) throw new Error("Vault has 20 snapshots. Archive this vault and configure a new data directory before refreshing");
      let snapshot: AgentVaultSnapshot;
      if (existing) snapshot = existing;
      else {
        const notes: AgentVaultNote[] = collected.sources.map(s => ({ path: `Snapshots/${id}/${s.key}`, title: s.title, kind: s.kind, source: redactText(s.source, 400) }));
        const overview = `# ${project.name} — Agent progress\n\nSource repository: ${project.path}\n\nCaptured: ${now}\n\n## Notes\n\n${notes.map(n => `- [[${n.path.replace(/\.md$/, "")}|${n.title.replace(/[\[\]|]/g, "")}]] · ${n.kind}`).join("\n")}\n\n## Collection limits\n\n${collected.warnings.join("\n\n") || "No collection warnings."}\n\n${collected.truncated ? "Partial snapshot: some sources exceeded collection limits." : "Within the configured collection limits."}\n`;
        for (const source of collected.sources) await writeVaultArtifact(state.root, `Snapshots/${id}/${source.key}`, noteBody(source, project.path, collected.sources));
        const overviewPath = `Snapshots/${id}/overview/Beranda.md`;
        await writeVaultArtifact(state.root, overviewPath, overview);
        notes.unshift({ path: overviewPath, title: "Agent progress", kind: "overview", source: "generated" });
        snapshot = { id, capturedAt: now, notes, warnings: collected.warnings, truncated: collected.truncated };
      }
      const next = { ...state, current: id, refreshedAt: now, snapshots: [snapshot, ...state.snapshots.filter(s => s.id !== id)] };
      await writeVaultArtifact(state.root, "manifest.json", `${JSON.stringify(next, null, 2)}\n`);
      return { state: next, changed: true };
    });
  } finally { active.delete(project.id); }
}
