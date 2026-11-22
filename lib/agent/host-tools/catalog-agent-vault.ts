import { clip, obj, str } from "./schema";
import type { HostTool } from "./types";
async function call(project: string, sync: boolean, note?: string): Promise<string> {
  const params = new URLSearchParams({ project });
  if (note) params.set("note", note);
  const response = await fetch(`/api/v1/agent-vault?${params}`, sync ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project }) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Agent vault request failed");
  return clip(JSON.stringify(result));
}
export const AGENT_VAULT_HOST_TOOLS: HostTool[] = [
  { name: "project.agent.vault.read", group: "agent", label: "Read agent vault", effect: "read", description: "Read one repository's separate agent-progress vault. Use an exact returned note path to read a snapshot note; no owner recall or raw transcripts.", parameters: obj({ "project!": str("Repository id, name or path"), note: str("Exact note path from the vault") }), run: (_api, a) => call(String(a.project || ""), false, typeof a.note === "string" ? a.note : undefined) },
  { name: "project.agent.vault.sync", group: "agent", label: "Refresh agent vault", effect: "mutate", description: "Capture a bounded repository agent-progress snapshot in a separate private Obsidian-compatible vault. Preserve existing snapshots and leave repository sources unchanged.", parameters: obj({ "project!": str("Repository id, name or path") }), run: (_api, a) => call(String(a.project || ""), true) },
];
