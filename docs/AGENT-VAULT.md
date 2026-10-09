# Agent Vault

> **Current reference.** Portable MSO feature code and installation-owned user data are separate.

Agent Vault is an owner-private MSO app at `/agent-vault`. It projects recorded agent
roles, project knowledge and progress from a selected repository into an independent
Markdown vault readable by both MSO and Obsidian. Snapshot data describes repository
evidence at capture time; an agent profile or commit never proves a live agent or a
healthy deployment.

## Source code and user data

| Layer | Location | Authority |
|---|---|---|
| Open source feature | `frontend/slices/agent-vault`, `lib/agent-vault`, shared contract and host facade | Portable implementation; no operator repo identities or user notes |
| Default source selection | `OS_AGENT_VAULT_PROJECT` in the installation's private environment | Optional repo id/name/path; browser selection can override it |
| Vault data base | `OS_AGENT_VAULT_ROOT`, default `~/mso-vaults` | Installation-owned data outside the MSO checkout and selected source repository |
| One repository vault | `<base>/<safe-repo-name>-<hash-of-project-id>` | Distinct roots even when repositories have the same name |
| Snapshots and index | `Snapshots/<content-digest>/…`, `manifest.json` | Generated projection; repository sources remain authoritative |

No private repository content, source path, persona, conversation or runtime configuration
belongs in the MSO Git repository. Do not configure the vault base inside any source
checkout. Storage inside either MSO's checkout or the selected source repository is rejected. Paths retain the normal host
`OS_FS_READ_ROOTS` / `OS_FS_WRITE_ROOTS` bounds and credential exclusions.
Vault ownership follows MSO's Unix service account and existing device roles;
portable source code does not contain any installation's repository selection.

## Use

1. Open **Agent Vault** and enter the repository's validated id, name or path.
2. Select **Load** to read existing snapshots, or **Refresh snapshot** to capture changes.
3. Choose a snapshot, search its note list, and open a note.
4. In Obsidian, choose **Open folder as vault** and select the data directory shown in MSO.
   The overview note links to every generated note for Obsidian's local graph.

Example private environment (replace the source locally):

```dotenv
OS_AGENT_VAULT_ROOT=~/mso-vaults
OS_AGENT_VAULT_PROJECT=example-project
```

CLI:

```bash
mso agent-vault show example-project
mso agent-vault sync example-project
mso agent-vault read example-project '<exact note path returned by show>'
```

MCP tools are `project_agent_vault_read` (read scope) and
`project_agent_vault_sync` (write scope, filesystem audit). Alfa exposes the same
capabilities; refresh requires its normal mutation approval. Native API reads and
refreshes both require a live Owner device. Browser UI filtering is not authorization.
External clients with cached action catalogs need a tool rescan after upgrading;
MSO cannot remotely refresh a client's action snapshot.

## Collection and preservation

Sources are deliberately specific: `wiki/agents/*.md`, `wiki/projects/*.md`,
`wiki/log.md`, `docs/PROGRESS.md`, top-level Markdown summaries under
`inbox/{mso,hermes,gpt,grokbot}`, compact `.agent/memory` records and recent Git commits.
Secrets are redacted before persistence. Adapter configuration, raw transcripts,
personal wiki pages, credentials and nested archived inbox material are not collected.
No source repository writes, agent activation, model calls, Git fetch or automatic
background schedule occur during capture.

Capture preserves every completed older snapshot and user annotations within it.
Unchanged source content reuses the current snapshot. The manifest is atomically
replaced only after the new notes are written; a failed capture leaves the previous
published snapshot readable. Files are private (0600) and directories private (0700).

Limits: 80 source Markdown files, 600 directory entries, 48 KiB per source, 40 compact
memory records and 20 recent commits. Notes exceeding a cap are skipped or shortened
and the snapshot is marked partial. Each server process runs at most two refreshes;
the existing private-store lock serializes each repository across processes. Each vault retains up to 20 distinct snapshots; when full it fails
without deleting history. Archive the data directory and select a new base for more
captures. A personal Obsidian vault and MSO's general assistant memories remain
separate; their data is not imported.

## Backup and rollback

Back up the vault data directory independently of the MSO source checkout. Disabling
the feature or reverting its code does not delete user data. Never commit snapshots,
manifests, vault settings or source-selection environment files into the open source
project.
