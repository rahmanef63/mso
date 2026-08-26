# Security Policy

Manef Shell OS is Public Alpha / Developer Preview software. It has not had a
third-party security audit. Only the latest commit on `main` is supported; there are no
release branches yet.

The project's repeatable automated and manual verification lanes are documented in
[`docs/SECURITY-ASSURANCE.md`](./docs/SECURITY-ASSURANCE.md). They are security evidence, not
a certification or a substitute for an independent third-party audit.

## Reporting a vulnerability

Do not open a public issue containing exploit details or secrets. GitHub private
vulnerability reporting is enabled for this repository; use **Security → Report a vulnerability**.
Include the affected commit, reproduction steps, impact and sanitized logs.

Never post passwords, session secrets, API keys, bearer tokens, private file contents,
Camoufox profile data or full environment files.

## Deployment warning

An authenticated MSO owner session can read allowed files and run commands as the Linux user
that owns the process. Treat it like SSH in a browser.

- Run MSO as a dedicated non-root user.
- Prefer Tailscale/VPN for a real deployment.
- Otherwise use HTTPS plus firewall/allowlist controls in front of the app.
- Do not expose the raw app port directly to the public internet.
- Keep `OS_FS_WRITE_ROOTS` narrow and review read roots deliberately.
- Do not commit `.env.local`, model credentials or data under `~/.mso`.
- Use `NEXT_PUBLIC_OS_DEMO=1` only in a separate mock-only public demo checkout.

## Authentication and sessions

The owner login is password + device approval. A correct password on a new browser creates a
pending device; an already-approved device or the server must approve it before a normal
session is issued. The browser session cookie is HMAC signed and `Secure`.

Changing `OS_SESSION_SECRET` invalidates existing sessions. Removing a device from the
allowlist revokes that browser. Device approval is an allowlist, not standards-based MFA.

## Filesystem and command boundary

File routes inherit `OS_FS_READ_ROOTS` / `OS_FS_WRITE_ROOTS`, canonical containment checks
and a credential denylist. MSO's own private state, `.env*`, SSH/GPG material and other
sensitive-home paths are hidden/refused unless the supervised sensitive-path escape hatch is
explicitly enabled.

`exec.run` / MCP `exec_run` runs as the MSO Linux user. The destructive-command matcher is a
short accident tripwire, not a sandbox. Interactive Terminal PTYs are even more direct: raw
keystrokes cannot be reliably parsed into commands, so authentication and PTY session
lifecycle—not the one-shot command matcher—are the boundary.

## Alfa model data

Alfa credentials are stored server-side in private host config. BYOK means the owner controls
the credential; it does **not** mean model traffic stays on the VPS. Messages and tool
context included in a model request go to the selected provider.

Alfa's read tools can supply file/process/log data to the model. Host mutations use the
visible Alfa approval-card boundary. Treat file/log contents as untrusted prompt input and
review the actual proposed mutation, not only the model's explanation.

## MCP / ChatGPT / external AI clients

The MCP server is off unless `OS_MCP_ENABLED=1`. External clients authenticate through MSO's
OAuth 2.1 + PKCE flow and receive a bearer with `read`, `write` or `exec` scope, capped by
`OS_MCP_MAX_SCOPE`.

An MCP bearer is a standing credential. At `exec` scope it can execute host commands as the
MSO user. Scope is rechecked on every tool call. Tool inputs and results are also processed
by the connected AI client/provider according to that product's data controls.

Use `read` unless a workflow truly needs more, revoke stale clients in Settings → MCP and
refresh the client tool snapshot when MSO's toolset signature changes. See
[`docs/MCP.md`](./docs/MCP.md) and [`docs/CHATGPT-PLUGIN.md`](./docs/CHATGPT-PLUGIN.md).

`browser_status` deliberately never returns Camoufox's viewer password or profile data.
`screen_capture` is limited to MSO itself, not arbitrary web pages.

## Managed applications and per-app origins

MSO can manage Hermes and OpenClaw as separate applications. They keep their own runtime,
config, state and host privileges. MSO can install them, control lifecycle, read logs,
update, back up, restore and conservatively uninstall through explicit managed-app paths.
Restore is the intentional exception to the general rule that MSO should not edit another
app's state: it is heavily gated, requires the app stopped, creates a pre-restore safety
snapshot and writes only into the verified state directory.

Vendor dashboards require `allow-same-origin` to function. Running that JavaScript on the
cockpit origin would give it the owner's browser realm/session. MSO therefore has no
supported same-origin dashboard mode.

The safe default is **no embedded vendor dashboard**. To embed dashboards, set both
`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` and `OS_SESSION_COOKIE_DOMAIN` and give each app a
separate hostname, for example:

```text
mso.example.com
hermes.mso.example.com
openclaw.mso.example.com
```

On a managed-app hostname every request is routed only into that app's proxy and cockpit
pages/API/static chunks are not served there. Keep DNS explicit; do not point arbitrary
wildcards inside the shared cookie domain at MSO.

This is a browser-realm boundary only. A plugin installed **inside Hermes or OpenClaw**
runs with that daemon's host privileges. Installing an untrusted daemon plugin is equivalent
to trusting code with that user's capabilities; iframe origin separation does not sandbox
it.

## Managed-app backups

Managed-app snapshots live under `~/.mso/backups/<app>/<timestamp>/` and can contain the
application's own credentials, pairings and history. Treat those copies like the source
state. They are private but not encrypted by MSO.

Backups skip symlinks and reinstallable/cache directories. Restore validates the manifest,
app identity, state path and symlink collisions before writing, then creates an additional
`pre-restore` safety snapshot. See [`docs/MANAGED-APPS.md`](./docs/MANAGED-APPS.md).

## In scope

- auth/session/device-approval bypass;
- practical login rate-limit defeat;
- filesystem-jail or credential-denylist escape;
- unauthenticated access to live host/config routes;
- CSRF/clickjacking that triggers owner host actions;
- MCP scope/OAuth bypass or bearer validation failure;
- managed-app origin escape into the cockpit or a sibling app;
- managed-app proxy SSRF/target escape;
- backup/restore path escape or symlink-following writes;
- secret leakage through logs, tool descriptors, temporary shares or browser-status APIs.

## Out of scope

- an already-authenticated owner intentionally using documented owner capabilities;
- bypassing the one-shot destructive-command regex after the user already granted shell
  execution—it is not presented as a sandbox;
- deployments that ignore the minimum documented posture;
- what trusted/untrusted code installed *inside* Hermes/OpenClaw can do with that daemon's
  own host permissions;
- prompt/model quality issues that do not bypass MSO's server-side permission boundary.

## Rotation and retention

- change `OS_SESSION_SECRET` to invalidate browser sessions;
- change `OS_LOGIN_PASSWORD` to rotate the owner password;
- remove entries from `~/.mso/auth-devices.json` to revoke browsers;
- remove/revoke MCP tokens from Settings → MCP;
- rotate provider credentials from Settings → AI or the corresponding environment source;
- rotate managed-app credentials if a state snapshot containing them was exposed.

`~/.mso/audit.log` is append-oriented local forensic data and can grow. Use normal host log
retention/rotation and inspect it before sharing because paths and command context can be
sensitive.
