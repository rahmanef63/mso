---
name: mso-list
description: Audit MSO capabilities honestly: inventory every /api/v1 route, live-probe the safe core, report exact probe coverage, and distinguish PASS, FAIL, and UNPROBED.
metadata:
  mso:
    risk: low
    policy: verify-dont-assume
---

# /mso-list — capability inventory + live audit

Run the audit from the installed repo, not a hardcoded home path:

```bash
MSO_ROOT="${MSO_DIR:-$(systemctl show -p WorkingDirectory --value mso.service 2>/dev/null || true)}"
[ -n "$MSO_ROOT" ] || MSO_ROOT="$HOME/mso"
node "$MSO_ROOT/claude-skills/mso-list/audit.js"
```

The report has two distinct truths:

1. **Route inventory** — every `app/api/v1/**/route.ts` present in this build.
2. **Live probes** — only endpoints exercised end-to-end against the running server.

A route not probed is **UNPROBED**, never green by association. Dynamic app jobs, secret-returning endpoints, long-running update/install operations, streaming PTYs, and other high-side-effect routes are intentionally not fired merely to increase a coverage percentage.

## App capability map

| App/surface | Capability |
|---|---|
| Files / Code | bounded file CRUD, search, usage, raw/zip/upload |
| Terminal / runtime command apps | full host execution; highest-risk fallback |
| System Monitor | stats/processes; maintenance routes are separate |
| Browser | Camoufox status/power; secret viewer credential is human-only |
| Managed Apps | list/status/logs/start/stop/restart/backup/update/install/restore/uninstall/jobs |
| Image/Media Studio | shared editor document registry; browser rendering |
| Settings / Assistant | configuration, devices, models, tools, trusted skills |

For complete CLI verbs use `"$MSO_ROOT/bin/mso" -h` and generated `docs/CLI.md`. Do not maintain a second hand-written endpoint list here.
