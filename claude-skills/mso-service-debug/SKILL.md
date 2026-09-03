---
name: mso-service-debug
description: "Diagnose an MSO or managed-app failure with the smallest safe path: telemetry, bounded status and logs, one scoped system batch only when needed, then restart and verify."
metadata:
  mso:
    risk: medium
    policy: observe-before-restart
---

# /mso-service-debug — diagnose before touching service state

Call `workflow_start` directly for a multi-step incident and carry its exact `workflow_id` on every operational call. Begin with `sys_stats`, `apps_list`, and `apps_logs`; these answer most CPU, memory, stopped-service, and journal questions without shell power.

Use one scoped `exec_run` batch only when bounded tools cannot identify the cause:

```bash
set -euo pipefail
systemctl --no-pager --full status <unit> || true
journalctl -u <unit> -n 120 --no-pager || true
ss -ltnp | head -n 80
```

Do not restart first and erase the failure state. Record the first concrete error, inspect its configuration/source, then make the smallest repair. Prefer `apps_power` for known managed applications. After restart, verify active state, endpoint health, relevant logs, and—when UI changed—capture the MSO screen. Save the verified route with `workflow_finish`.
