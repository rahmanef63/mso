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

An authenticated MSO **Owner** session can read allowed files and run commands as the Linux user
that owns the process. Treat Owner like SSH in a browser. Viewer and Operator are narrower
application roles, but they still share the same deployment and underlying Unix account.

- Run MSO as a dedicated non-root user.
- Prefer Tailscale/VPN for a real deployment.
- Otherwise use HTTPS plus firewall/allowlist controls in front of the app.
- Do not expose the raw app port directly to the public internet.
- Keep `OS_FS_WRITE_ROOTS` narrow and review read roots deliberately.
- Do not commit `.env.local`, model credentials or data under `~/.mso`.
- Use `NEXT_PUBLIC_OS_DEMO=1` only in a separate mock-only public demo checkout.

## Authentication and sessions

The deployment login is password + device approval. A correct password on a new browser creates a
pending device; an Owner device or the local server CLI assigns it one live role before a normal
session is issued:

- **Viewer** — read-scoped workspace surfaces such as bounded files, telemetry, service inventory,
  package visibility, docs and previews;
- **Operator** — Viewer plus bounded operational surfaces such as Camoufox, managed-app start/stop/restart/backup,
  service journals and exact-allowlisted service actions;
- **Owner** — full MSO host authority, including writes, PTY/exec, credentials, self-update, MCP,
  device administration and managed-app install/update.

Roles are read from the private device store on every request; demotion and revocation therefore do
not wait for the signed cookie to expire. Shared Appearance, Theme and Quicklink preferences may be read by delegated devices but changed only by Owner because the current store is deployment-wide, not per-device. The UI also filters inaccessible apps, but the route policy
is the actual boundary: unknown mutations fail up to Owner by default. Role-less records created by
older MSO versions migrate as Owner; malformed role values fail down to Viewer.

Changing `OS_SESSION_SECRET` invalidates existing sessions. Removing a device from the allowlist
revokes that browser. Device approval is an allowlist, not standards-based MFA, a named-user
directory, Linux-account mapping, or enterprise SSO. Multiple people can use distinct approved
devices, but they still authenticate to one deployment secret and one Unix service account.

## Filesystem and command boundary

File routes inherit `OS_FS_READ_ROOTS` / `OS_FS_WRITE_ROOTS`, canonical containment checks
and a credential denylist. MSO's own private state, `.env*`, SSH/GPG material and other
sensitive-home paths are hidden/refused unless the supervised sensitive-path escape hatch is
explicitly enabled.

`exec.run` / MCP `exec_run` runs as the MSO Linux user. The destructive-command matcher is a
short accident tripwire, not a sandbox. Interactive Terminal PTYs are even more direct: raw
keystrokes cannot be reliably parsed into commands, so authentication and PTY session
lifecycle—not the one-shot command matcher—are the boundary.

## Static-analysis and file-safety boundaries

Hosted CodeQL findings are treated as release blockers until they are either remediated or proven
false positives with a narrow, reviewable justification. The current implementation applies the
following source-level controls in addition to route authorization:

- provider/config/OAuth maps accept validated provider identifiers and rebuild records from entry
  lists rather than assigning or deleting attacker-selected object properties;
- login-secret equality uses a fixed-width constant-time byte comparison; no fast password hash
  or reusable password verifier is created, and over-limit UTF-8 input fails closed;
- thread identifiers are accepted or rejected as a whole, then pass an explicit `path.relative`
  containment check whose filesystem sink stays inside the proven-safe branch before any filesystem operation; they are never rewritten into colliding names;
- bounded host reads, lock recovery, skill/catalog reads and model-cache reads bind metadata and
  content to the same `O_NOFOLLOW` file descriptor where the platform supports it;
- read/write root policy performs lexical containment before filesystem resolution and canonical
  containment afterward, so nonexistent outside paths and escaping symlinks both fail closed;
- the models.dev catalog uses one fixed HTTPS endpoint, bounded streaming, object-shape validation,
  a private `0700` cache directory and atomic `0600` cache replacement;
- external widget embeds allow only credential-free external HTTPS URLs, omit `allow-same-origin`,
  and send no referrer; local image previews accept a raster MIME allowlist and revoke object URLs;
- uploaded files use random exclusive temporary names, revalidate the destination after directory
  creation, reject traversal instead of normalizing it away, and remove partial files on every exit;
- the intentional ChatGPT-to-VPS file bridge is write-scope only, accepts temporary URLs only from
  reviewed OpenAI content/storage hosts, revalidates every redirect, streams with a 20 MiB hard cap,
  checks response MIME and PNG/JPEG/WebP signatures, then enters the same write-root, credential,
  exclusive-temporary-file and atomic-rename path as an ordinary authenticated upload. Generic
  `application/octet-stream` remains deliberately content-agnostic because this is a file-transfer
  surface, not an executable installer; transferred bytes are never executed automatically by MSO.

These controls reduce known classes of path race, prototype-pollution, DOM trust, and unbounded
network-to-disk issues. CodeQL can still correctly describe the last bridge as network data written
to disk: that data flow is the feature itself, so any GitHub dismissal must use the narrow
`won't fix` classification with this control rationale—not `false positive`. None of these controls
turn automated static analysis into a proof of complete security.

## Service and package operations

System Monitor exposes system/user `systemd` inventory to Viewer devices. Journal reads require
Operator, are capped, and accept only validated `.service` unit names. Lifecycle actions require
Operator or Owner **and** an exact `scope:unit` entry in `OS_SERVICE_CONTROL_UNITS`; empty is the
default, wildcards and malformed entries are rejected, and the host helper uses fixed argv without
a shell. System-scope control additionally depends on the Unix user's existing permission, or an
explicit `OS_SERVICE_CONTROL_USE_SUDO=1` deployment with narrowly-scoped non-interactive sudo.

Package Updates is visibility-only. It reads the supported package manager's existing local cache
with bounded commands (`apt list --upgradable`, cache-only DNF/YUM, `pacman -Qu`, or no-refresh
Zypper). It does not refresh metadata, install packages, or perform an upgrade.

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

MSO can manage Hermes, OpenClaw and 9Router as separate applications. They keep their own runtime,
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

Camoufox/noVNC uses the same browser-realm principle through the reserved `camoufox` host in
that namespace. The host accepts only Operator/Owner-session GET/HEAD requests, strips cockpit
cookies/authorization before loopback noVNC, and applies a restrictive CSP. The old
`/camoufox-vnc/*` cockpit path is permanently closed. Revoking an approved device also stops the
Camoufox service cgroup so an already-established VNC WebSocket is evicted.

Managed-app installation is also fail-closed. Hermes installer bytes and checkout commit,
OpenClaw package bytes/version, and the 9Router image digest are committed in
`security/managed-app-artifacts.env` and verified before execution. 9Router binds to loopback by
default; `NINE_ROUTER_EXPOSE_PUBLIC=1` is an explicit operator exception, not an inferred fallback.

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

- auth/session/device-approval or role-escalation bypass;
- practical login rate-limit defeat;
- filesystem-jail or credential-denylist escape;
- unauthorized access to live host/config routes or a role-restricted app;
- service-control allowlist bypass, unit/argv injection, or package-visibility mutation;
- CSRF/clickjacking that triggers owner host actions;
- MCP scope/OAuth bypass or bearer validation failure;
- managed-app origin escape into the cockpit or a sibling app;
- managed-app proxy SSRF/target escape;
- backup/restore path escape or symlink-following writes;
- secret leakage through logs, tool descriptors, temporary shares or browser-status APIs.

## Out of scope

- an already-authenticated Owner intentionally using documented Owner capabilities;
- an Operator intentionally controlling an exact owner-allowlisted service;
- bypassing the one-shot destructive-command regex after the user already granted shell
  execution—it is not presented as a sandbox;
- deployments that ignore the minimum documented posture;
- what trusted/untrusted code installed *inside* Hermes/OpenClaw can do with that daemon's
  own host permissions;
- prompt/model quality issues that do not bypass MSO's server-side permission boundary.

## Rotation and retention

- change `OS_SESSION_SECRET` to invalidate browser sessions;
- change `OS_LOGIN_PASSWORD` to rotate the owner password;
- change device roles or revoke browsers in Settings → Devices / `mso device`; use the local CLI for recovery;
- remove/revoke MCP tokens from Settings → MCP;
- rotate provider credentials from Settings → AI or the corresponding environment source;
- rotate managed-app credentials if a state snapshot containing them was exposed.

`~/.mso/audit.log` is append-oriented local forensic data and can grow. Use normal host log
retention/rotation and inspect it before sharing because paths and command context can be
sensitive.
