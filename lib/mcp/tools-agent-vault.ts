import { getAgentVault, syncAgentVault } from "@/lib/host/agent-vault-api";
import { opt, S, str, type McpTool } from "./tool-kit";
export const AGENT_VAULT_TOOLS: McpTool[] = [
  {
    name: "project_agent_vault_read", scope: "read",
    chatgptDescription: "Read repository vault snapshots/notes.",
    description: "Read one repository's separate Obsidian-compatible agent-progress vault, snapshots and note metadata. Optional note must be an exact path returned by this tool. No refresh, raw transcripts or owner recall.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "agent.vault.read", max: 60, windowMs: 60_000 },
    inputSchema: S({ project: { type: "string", maxLength: 500 }, note: { type: "string", maxLength: 300 } }, ["project"]),
    run: a => getAgentVault(str(a, "project"), opt(a, "note")),
  },
  {
    name: "project_agent_vault_sync", scope: "write",
    chatgptDescription: "Refresh repository vault snapshots.",
    description: "Capture a bounded agent-progress snapshot from one selected repository into its separate private Markdown vault. Sources: wiki agent/project pages, top-level platform inbox summaries, progress log, compact .agent memory, latest 20 commits. Preserves previous snapshots; does not edit the source repository or run agents.",
    annotations: { idempotentHint: true },
    audit: { action: "fs.write", targetArg: "project" },
    limit: { key: "agent.vault.sync", max: 10, windowMs: 60_000 },
    inputSchema: S({ project: { type: "string", maxLength: 500 } }, ["project"]),
    run: a => syncAgentVault(str(a, "project")),
  },
];
