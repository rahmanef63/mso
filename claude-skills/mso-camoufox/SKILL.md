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

## What an agent may do

- Check installed/running state.
- Start or stop the Camoufox service through the bounded browser capability.
- Tell the user to open the Browser app / Settings to drive the live screen.
- Diagnose non-secret service failures and resource pressure.

## What an agent must never retrieve or expose

- the one-time noVNC/VNC password or a URL containing it;
- cookies, `cookies.sqlite*`, `key4.db`, `cert9.db`, storage state, auth headers;
- Google/LinkedIn session tokens or any browser profile secret;
- raw profile or backup contents.

The CLI has a human/operator command that can reveal the one-time VNC credential. **Do not invoke that command from an agent.** The omission of session credentials from bounded MSO tools is intentional least privilege, not a missing feature.

## Power only

If no bounded browser tool exists in the current runtime, resolve the local CLI and limit automation to status/start/stop:

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
