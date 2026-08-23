---
name: mso-apps
description: Map every MSO app to the safest operation that drives it. Prefer bounded capabilities, use document CRUD for editor data, and reserve full shell for uncovered host actions.
metadata:
  mso:
    risk: medium
    policy: bounded-first
---

# /mso-apps — app → capability map

Resolve MSO dynamically; never assume `/home/<name>/...`:

```bash
MSO_ROOT="${MSO_DIR:-$(systemctl show -p WorkingDirectory --value mso.service 2>/dev/null || true)}"
[ -n "$MSO_ROOT" ] || MSO_ROOT="$HOME/mso"
MSO_CLI="$MSO_ROOT/bin/mso"
IE="$MSO_ROOT/claude-skills/mso-image-editor/image-editor.sh"
```

## Safety precedence

When the current environment exposes bounded MSO tools, use those first. The CLI is for parity/debugging. `exec` is the final fallback, not the default transport.

| App | Main functions | Preferred control |
|---|---|---|
| Files | list/read/search/new/rename/move/copy/delete/usage | bounded `fs.*`; CLI `ls/cat/write/mkdir/mv/cp/rm/usage` |
| Code Editor | tree/open/edit/save/new file | bounded `fs.list/read/write` |
| Terminal | host commands | bounded operation if one exists; otherwise scoped `exec` |
| System Monitor | CPU/mem/disk/processes | bounded `sys.stats/processes` |
| Browser | real Camoufox Firefox | bounded status/power; human drives VNC UI |
| Media Viewer | inspect media | bounded file read/raw; `ffprobe` only if needed |
| Image/Media Studio | layers/text/shapes/adjustments | editor document CRUD via `$IE`; render in real editor |
| Reel Editor | timeline/render | browser/client; shell only for explicit media preprocessing |
| Settings | devices/provider/theme/server mode | dedicated settings/UI; never expose secrets |
| Assistant | chat + tools + skills | `/api/assistant`; trusted skills only |
| Managed apps | detect/install/status/logs/start/stop/restart/backup/update/restore/uninstall/jobs | bounded list/log/power for direct actions; MSO Details/API/CLI for long-running update/install/restore/uninstall workflows |
| Runtime apps | app-defined actions | use declared app capability; command runtimes are full shell risk |

## Important boundaries

- Browser VNC password/session credentials are never agent output.
- Raster painting, masks, background removal and final editor rendering are browser-owned; do not invent a second headless renderer.
- LocalStorage state is browser-owned and is not generic host CRUD.
- System telemetry is read-only.
- A task is "working" only when its backing call was actually probed. Use `node "$MSO_ROOT/claude-skills/mso-list/audit.js"` for the live audit.
