---
name: mso-camoufox
description: "Operate MSO's Camoufox browser safely: inspect status and power the session, while keeping VNC credentials, cookies, and logged-in profile data human-only."
metadata:
  mso:
    risk: high
    policy: credential-isolation
---

# /mso-camoufox — real Firefox without leaking the session

Camoufox is MSO's anti-fingerprinting Firefox on a headless X display. It is useful for **authorized** access when ordinary automation is blocked by fingerprinting.

## Two browser modes

1. **Agent automation (default for website checks/audits):** use the verified `camoufox-browse` skill with a disposable profile. The persistent `camoufox-vnc.service` may remain off. Do not reuse the human profile or its cookies.
2. **Human persistent Browser app:** use `browser_status` / `browser_power` only when the user wants the live MSO Browser window or explicitly needs the saved human browser session.

## What an agent may do

- Treat `running: false` as the normal idle state, not a failure.
- For automated site inspection, discover/read `camoufox-browse` and run it with a disposable profile.
- Check installed/running state of the persistent Browser app.
- Start or stop the persistent Camoufox service through the bounded browser capability when that mode is actually required.
- If the agent found the persistent session off and started it itself, stop it after the task unless the user asked to leave it running.
- Tell the user to open the Browser app / Settings to drive the live persistent screen.
- Diagnose non-secret service failures and resource pressure.

## What an agent must never retrieve or expose

- the one-time noVNC/VNC password or a URL containing it;
- cookies, `cookies.sqlite*`, `key4.db`, `cert9.db`, storage state, auth headers;
- Google/LinkedIn session tokens or any browser profile secret;
- raw profile or backup contents.

The CLI has a human/operator command that can reveal the one-time VNC credential. **Do not invoke that command from an agent.** The omission of session credentials from bounded MSO tools is intentional least privilege, not a missing feature.

## Persistent Browser app power

Do not power this service merely because a task mentions a browser. First decide whether the task needs the **human persistent session** or only automated inspection. Automated inspection uses `camoufox-browse` and leaves this service off.

If the persistent mode is required and no bounded browser tool exists in the current runtime, resolve the local CLI and limit lifecycle control to status/start/stop:

```bash
MSO_ROOT="${MSO_DIR:-$(systemctl show -p WorkingDirectory --value mso.service 2>/dev/null || true)}"
[ -n "$MSO_ROOT" ] || MSO_ROOT="$HOME/mso"
MSO_CLI="$MSO_ROOT/bin/mso"

"$MSO_CLI" camoufox status
"$MSO_CLI" camoufox start
# user opens the Browser app / Settings to obtain and use the private viewer session
"$MSO_CLI" camoufox stop
```

Do not enable the user service at boot. The browser intentionally has a finite lease and should stop when unused because it is resource-heavy and contains live sessions.

## Profile recovery

The profile is sensitive account state. Recovery is an explicit operator action: stop the browser, restore only from the configured private backup, preserve file permissions, then start it again. Require user approval before any restore and never inspect or print the restored files.

## Authorized-use rule

Use anti-detection only for accounts/tenants the user is authorized to access. It is not a mechanism for evading bans, bypassing access controls, or impersonating others.
