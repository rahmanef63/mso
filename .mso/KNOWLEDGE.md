# MSO — Knowledge

Short durable facts for fleet agents. Routing/policy lives in `AGENTS.md` and `CLAUDE.md`. Do not treat this file as a changelog.

## Ownership

- Owner bot: **mso**; reports to **manef** / fleet ops; Linear **RAH** / MSO project.
- GitHub SSOT: `rahmanef63/mso` branch `main`.

## Stack

- Next.js 16 + React 19 + TypeScript.
- Next was bumped 16.4.0 → 16.4.2 for RCE advisories (#147).

## Dual hosts (do not conflate)

- **Grok box cache:** its own public host (portable docs use `mso-grok.example.com`; the real name lives in operator config) → `/home/box/mso` on `:4005`, store `/home/box/.mso`, tunnel `809d494c`.
- **Laptop/WSL live cockpit:** historically the operator's own cockpit host (portable docs use `mso.example.com`), tunnel `8ed1ad29`. Agents must **not** change that tunnel or instance unless Rahman asks.

Passwords, approved devices, and builds are **not** shared across hosts.

## Coding path

- Heavy coding on Rahman's laptop only under `~/agent-work/mso/` via `opencode2 --auto`.
- Never edit live project folders (`~/projects/**`) or the live WSL MSO checkout.
- No Cursor cloud agents (Rahman 2026-10-22).

## Boundaries

- Local commit OK.
- Push, PR, merge, production secrets, new accounts, billing, and real client data need Rahman GO **in his own words** (agent-relayed OK does not count).
- Design/product: decide the best recommendation and proceed with local commits.

## Role split

- **SI-Coder (sc)** = vault, redaction, credential lifecycle.
- **MSO** = cockpit / MCP host.
- **connectors-gateway** = edge.

## Knowledge freshness

- Code last push ~2026-10-27 (tip includes #162).
- `AGENTS.md` was stale since 2026-10-18 until this update.
- This file created 2026-10-28.

## Recent landed product facts

Compact facts agents need; cite PR numbers, do not re-litigate:

- #154 live agent activity row + env-tunable turn budgets
- #155 PolyForm Noncommercial license
- #156–#159 dependency bumps
- #160 one Convex provider with a project dimension (closes #152); no dual `convex` / `convex-cloud` cards
- #161 Settings update: one cue, no toast / floating badge
- #162 antislop: no em dashes in user-visible copy
- Also since the AGENTS refresh window: #147 Next security; #146/#148 Composio Connect keys → `connect.composio.dev/mcp`; #150 demo logins; #151 provider picker; Orca MCP bridge + systemd `WorkingDirectory` fix

## Optional WIP

- Unpushed local worktrees may exist on the Grok box under `/workspace` (forge / mobile / QA). Do not invent details you cannot verify from this machine.
