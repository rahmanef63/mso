# MSO slice catalog

> **Current reference.** Counts are checked against the directory tree by
> `scripts/check-docs.mjs`; the directory remains the final authority.

<!-- slice-catalog: slices=22 appshell-features=10 -->

Every application is a vertical slice under `frontend/slices/`. Host-facing slices use the
shared API/host seam rather than reaching arbitrary Node host APIs from client code.

## Slices (22)

| Slug | Purpose |
|---|---|
| `app-store` | App Store / app discovery surface |
| `appshell` | Generic desktop/mobile shell framework |
| `assistant` | Alfa assistant, agents/playbooks and tool activity |
| `auth` | Authentication UI/helpers |
| `camoufox-browser` | Remote Camoufox/noVNC Browser app |
| `code-editor` | Code/text editor with integrated terminal |
| `create-app` | Create App manifest authoring surface |
| `docs` | In-app documentation browser |
| `files-manager` | VPS Files manager |
| `image-editor` | Layered raster image editor |
| `image-picker` | Reusable image/wallpaper picker |
| `infrastructure` | Dokploy/Cloudflare provider configuration and live inventory apps |
| `managed-apps` | Hermes/OpenClaw install/lifecycle/update/backup/proxy |
| `media-studio` | Image/media studio surface |
| `media-viewer` | Preview/Quick Look-style media viewer |
| `os-settings` | MSO Settings |
| `os-shell` | MSO consumer manifest/capabilities for AppShell |
| `os-terminal` | Interactive PTY Terminal / Claude Code surface |
| `quicklinks` | Website shortcuts/favicons |
| `reel-editor` | Video/reel timeline editor |
| `shell-settings` | Shared shell settings UI primitives |
| `system-monitor` | Live metrics/processes plus service inventory/logs/allowlisted lifecycle and cache-only package updates |

## AppShell feature directories (10)

`frontend/slices/appshell/features/` currently contains:

- `clipboard`
- `control-center`
- `desktop-icons`
- `force-quit`
- `inspector`
- `lock-screen`
- `notifications`
- `search`
- `shortcut-help`
- `widgets`

Not every directory is a user-visible slot contribution: `desktop-icons` and `force-quit`
are shell infrastructure used directly by the desktop runtime. `shell-settings` is a normal
top-level slice, not an AppShell feature directory.

See `docs/ARCHITECTURE.md` for the shell/manifest relationship.
