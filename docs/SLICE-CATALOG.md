# MSO feature module catalog (Svelte 5)

> **Current reference.** Counts are checked against the directory tree by
> `scripts/check-docs.mjs`; `frontend/svelte/src/lib/` remains the final authority.

<!-- slice-catalog: svelte-modules=22 -->

Every cockpit application lives under `frontend/svelte/src/lib/` and talks to the MSO
backend (`lib/` + `app/api/**`) or native Rust shell (`rust-shell/`). The legacy Next.js /
React `frontend/slices/` tree was archived to the private `mso-nextjs-checkpoint` repo and
removed during the Svelte 5 + Rust Shell full cutover.

## Svelte 5 Feature Modules (22)

| Module | Purpose |
|---|---|
| `agent-group` | Multi-agent discussion groups: several profiles take turns on one topic |
| `agent-vault` | Separate private repository agent-progress snapshots in an Obsidian-compatible Markdown vault |
| `assistant` | Alfa assistant chat, agent sessions, playbooks, and tool activity |
| `auth` | Login, session state, and device approval helpers |
| `catalog` | App Store and Extensions (MCP + Skills) catalog |
| `create-app` | Create App manifest authoring surface |
| `creative` | Image Editor, Media Studio, and Reel Editor |
| `docs` | In-app documentation browser |
| `editor` | Code/text editor |
| `files` | VPS Files manager |
| `infra` | Dokploy/Cloudflare provider configuration and live inventory |
| `integrations` | Integrations and Telegram/Discord Channels workspace |
| `managed-apps` | AppDeck managed OSS app install/lifecycle/update/backup/proxy |
| `media` | Media viewer and reusable icon/image pickers |
| `memory-graph` | Interactive knowledge and memory graph |
| `monitor` | System Monitor, Processes, Services, and Packages |
| `organization` | Owner-private organization chart and execution bindings |
| `runtime-apps` | Camoufox Browser, Bot Desktops, and n8n workspace |
| `settings` | MSO Settings, security, memory backup, and Software Update |
| `shell` | Desktop/mobile window manager, dock, command palette, lock screen, and notifications |
| `terminal` | Interactive PTY terminal |
| `workflows` | Native SVG workflow graph editor, triggers, and execution history |
