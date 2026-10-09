import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { readBoundedRegularFile } from "@/lib/host/bounded-read";
import { resolveReadable } from "@/lib/host/paths";
import { projectGitEdits } from "@/lib/host/projects-api";
import { listRepoMemoryRecords } from "@/lib/orchestration/repo-memory";
import { redactText } from "@/lib/orchestration/redaction";
import type { AgentVaultKind } from "@/lib/contracts/agent-vault";

export interface VaultSource { key: string; title: string; kind: AgentVaultKind; source: string; content: string }
const MAX_FILES = 80, MAX_ENTRIES = 600, MAX_BYTES = 48 * 1024;
const GROUPS: Record<string, AgentVaultKind> = { "wiki/agents": "agent", "wiki/projects": "project", "inbox/mso": "inbox", "inbox/hermes": "inbox", "inbox/gpt": "inbox", "inbox/grokbot": "inbox" };
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
export function sourceNote(source: string, kind: AgentVaultKind, body: string): VaultSource {
  const title = redactText(body.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(source, ".md"), 100);
  const slug = redactText(path.basename(source, ".md"), 100).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "note";
  return { key: `${kind}/${slug}-${hash(source)}.md`, title, kind, source, content: redactText(body, 32_000) };
}

export async function collectVaultSources(project: { path: string; name: string }) {
  const sources: VaultSource[] = [], warnings: string[] = [];
  let truncated = false, entriesSeen = 0;
  async function read(relative: string, kind: AgentVaultKind) {
    if (sources.length >= MAX_FILES) { truncated = true; return; }
    const file = path.join(project.path, relative);
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat) return;
    if (!stat.isFile() || stat.isSymbolicLink()) { warnings.push(`Skipped non-regular source: ${relative}`); return; }
    const readable = await resolveReadable(file);
    if (readable !== file) { warnings.push(`Skipped linked source: ${relative}`); return; }
    const body = await readBoundedRegularFile(file, MAX_BYTES);
    if (body === null) { truncated = true; warnings.push(`Skipped oversized or unreadable source: ${relative}`); return; }
    if (body.length > 32_000) truncated = true;
    sources.push(sourceNote(relative, kind, body));
  }
  for (const relative of ["wiki/log.md", "docs/PROGRESS.md"]) await read(relative, "progress");
  for (const [relative, kind] of Object.entries(GROUPS)) {
    const dir = path.join(project.path, relative);
    const canonical = await resolveReadable(dir).catch(() => null);
    if (canonical !== dir) continue;
    const handle = await fs.opendir(dir).catch(() => null);
    if (!handle) continue;
    const names: string[] = [];
    for await (const entry of handle) {
      if (++entriesSeen > MAX_ENTRIES) { truncated = true; break; }
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".md")) names.push(entry.name);
    }
    for (const name of names.sort()) await read(`${relative}/${name}`, kind);
    if (entriesSeen > MAX_ENTRIES) break;
  }
  try {
    const records = await listRepoMemoryRecords(project.path, { includeHistory: true, limit: 41 });
    if (records.length > 40) truncated = true;
    for (const record of records.slice(0, 40)) {
      const body = `# ${record.title}\n\nUpdated: ${record.updatedAt}\n\nKind: ${record.kind} · Status: ${record.status} · Result: ${record.result ?? "unknown"}\n\n${record.summary}`;
      sources.push(sourceNote(`.agent/memory/${record.kind}/${record.id}`, "memory", body));
    }
  } catch { warnings.push("Repository memory unavailable"); truncated = true; }
  try {
    const { edits, pagination } = await projectGitEdits(project.path, { limit: 20 });
    const body = `# Repository changes\n\nThese are repository commits, not proof that an agent is running or a deployment is healthy.\n\n${edits.map(e => `- ${e.createdAt} · ${e.shortSha} · ${redactText(e.author, 100)} — ${redactText(e.subject, 500)}`).join("\n")}`;
    sources.push(sourceNote("git:recent-commits", "progress", body));
    if (pagination.hasMore) warnings.push("Commit history shows the latest 20 commits");
  } catch { warnings.push("Git history unavailable"); truncated = true; }
  return { sources: sources.sort((a, b) => a.key.localeCompare(b.key)), warnings, truncated };
}
