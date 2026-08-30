# Installing MSO on a Linux server

> **Current reference.** The one-command installer is the supported path for a normal
> deployment. Manual commands below explain the model and recovery boundaries; release
> developers should use `bun run ship`, while operators update through Settings → About or
> `mso update` (`mso update run` remains accepted).

## 0. Requirements

- Linux; systemd is required for the installed background service, but not for the CLI;
- WSL2 is supported for the CLI. Full service mode requires systemd enabled as PID 1;
- Node.js 20.9+ (Node 22 recommended/current production runtime);
- Bun for dependency installation/scripts;
- a non-root user that owns MSO;
- enough memory/swap for a Next production build (build needs more than idle runtime);
- HTTPS through Tailscale Serve or a reverse proxy for normal non-localhost browser use.

Optional Browser support additionally needs Camoufox, Xvfb, a lightweight X window manager,
x11vnc, noVNC/websockify and a user systemd runtime.

## 1. Recommended one-command install

Run as the normal server user, not root:

```bash
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
```

`scripts/install.sh` is intentionally a tiny bootstrap. It downloads `scripts/install-core.sh`
completely into a private temporary file, retries transient transfers, checks a committed SHA-256,
requires the exact EOF marker, runs `bash -n`, and only then executes the payload. The large
installer is therefore never executed while bytes are still arriving over the network.

The installer core:

1. resolves/creates the checkout and records whether this is a fresh install;
2. installs and validates `~/.local/bin/mso` **before dependency installation or build**, then
   attempts a guarded `/usr/local/bin` launcher when that directory is already on the invoking
   shell's PATH;
3. verifies whether the invoking shell will actually resolve `mso` after the child installer
   returns, and persists an idempotent `~/.local/bin` PATH fallback for future shells;
4. installs Bun/dependencies as needed;
5. creates private owner auth configuration when missing;
6. runs the production build through `node node_modules/next/dist/bin/next build`, bypassing Bun's
   package-bin remapper; if the Next package payload itself is absent, it performs one bounded
   `bun install --force` repair before failing;
7. installs the `mso.service` system unit only when systemd is really PID 1 (not merely when a
   `systemctl` executable exists);
8. enables the owner's lingering user manager needed by self-update/managed-app user units;
9. activates the service only after a successful build;
10. on a fresh interactive install with a verified running service, opens `/dev/tty` and launches `mso onboard`.

Useful flags:

```text
--dir PATH       installation directory
--ref REF        branch/tag/ref (default main)
--port N         app port (default 4005)
--bind ADDR      listen address (default 127.0.0.1)
--no-service     build without installing the system unit
--onboard        force guided onboarding (including on an update)
--no-onboard     suppress automatic onboarding
-y, --yes        non-interactive safe defaults; no external accounts/apps/skills
--uninstall      remove the system unit; keep code + ~/.mso
```

The public bootstrap is delivered through pipeline stdin, and the core deliberately does not
make interactive setup depend on that stream. It prompts through `/dev/tty`. If there is no controlling terminal it
never waits for input and tells the operator to run `mso onboard` later. Re-running the
installer updates an existing installation with the same build-before-replace safety rule
and does not repeat onboarding unless `--onboard` is requested.

### Guided onboarding

Run or resume it at any time:

```bash
mso onboard
```

It first approves the **local CLI device** as Owner in the device allowlist (a process already running
as the owning Unix account has equivalent host authority). On a loopback install it then verifies the
MSO `/api/health` contract; when WSL has no active system service it can start the already-built Next
production runtime itself, still bound to loopback, before proving the authenticated session. A dead
runtime is reported as a runtime problem — it is not misreported as a device-approval failure. API keys are read with terminal echo
disabled and posted from stdin; they are not placed in the CLI/curl argv.

The current provider choices are OpenAI ChatGPT/Codex device OAuth, plus API-key providers
Anthropic, OpenAI Platform, OpenRouter, Google, Groq, xAI, DeepSeek and Mistral. OpenRouter
is an API-key integration here, not OAuth. The OpenAI OAuth path is the ChatGPT consumer
Codex backend; it is separate from OpenAI Platform API keys and separate again from MSO's
ChatGPT MCP OAuth.

Hermes/OpenClaw installation is optional and uses each app's existing managed-job installer.
Their model/provider configuration belongs to those applications and is not implicitly
filled from Alfa's credential. Selected app installs stream their job transcript until a
terminal status.

### WSL2

WSL can contain `systemctl` while still running a non-systemd PID 1. MSO treats those as two
different capabilities: the CLI is installed normally, while the background service is skipped
with an explicit message. This prevents service setup from aborting before `mso` exists.

Without systemd, `mso web` is the supported local UI path: it starts the existing production build on
loopback when necessary. `mso gateway start` adds an outbound temporary HTTPS tunnel on top of that
without publishing the app port. `mso update` also works without the web API: it fast-forwards a clean
`main`, installs dependencies, verifies an out-of-tree build, and builds in place while no service is
active.

For the full service on WSL2, enable systemd in `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Then exit all WSL sessions from Windows, reopen the distro, confirm `ps -p 1 -o comm=` reports
`systemd`, and re-run the installer. The installer never edits WSL host configuration itself.

If the installer reports that the current shell did not already contain a reachable launcher
directory, use the exact PATH command it prints for that shell; the profile change is already
persisted for future shells.

If Bun 1.3.x reports `could not open bin metadata file` / `Bun failed to remap this bin`, that
is a package-bin metadata failure rather than evidence that the installed Next package is absent.
The supported installer does not use `bun run build` for the production build anymore: it invokes
Next's Node entrypoint directly. The CLI has already been installed at that point, so even an
unrelated build failure leaves `mso -h` available and the installer still exits non-zero with the
failed phase. Re-running the same one-liner is the supported recovery path.


## 2. Network exposure

The installer binds `127.0.0.1` by default. This is intentional: an authenticated MSO Owner
session can execute host commands, and delegated roles still expose private server data.

For an initial connection, use a localhost tunnel:

```bash
ssh -N -L 4005:127.0.0.1:4005 you@your-server
```

Then open `http://localhost:4005`. A `Secure` cookie is accepted on localhost, but ordinary
plain-HTTP IP/hostnames will drop it.

### Public preview from a laptop / WSL (no custom domain)

Keep MSO bound to loopback. No system-wide tunnel package is required:

```bash
mso gateway doctor
mso gateway install       # optional prefetch; `start` does this automatically
mso gateway start
mso gateway url
mso web
# when finished
mso gateway stop
```

`gateway start` installs only the reviewed Cloudflare binary pinned by exact release URL + SHA-256
in `security/gateway-artifacts.env`, then creates an outbound Quick Tunnel to `127.0.0.1:4005`; it
never changes the application bind to `0.0.0.0`. The tool cache is user-local and the tunnel is run
with Cloudflare auto-update disabled. The tunnel process also receives a scrubbed environment rather
than inheriting MSO login/session/BYOK secrets from the application shell. If systemd is unavailable (common on WSL), it may start the
already-built Next production runtime itself, still on `127.0.0.1`, and records whether that process
is gateway-owned. `gateway stop` terminates only recorded identities: Cloudflared is matched by PID/start-time/executable/exact argv, while the Next fallback uses PID/start-time/Node executable plus a random runtime-instance nonce echoed by `/api/health` so Next's mutable process title cannot confuse ownership. Private state and logs are owner-only.

This is intentionally labeled **temporary preview**. The random `trycloudflare.com` URL changes on
restart, and Cloudflare Quick Tunnels do not support Server-Sent Events; MSO Terminal's live output
uses SSE. Use a named tunnel/stable HTTPS origin for full functionality.

Do not add the random Quick Tunnel URL to `OS_PUBLIC_ORIGIN`: that variable is deployment authority
for stable MCP/share/CSP URLs. If a stable value is already configured, temporary mode leaves it
untouched and warns that generated links may continue to name the stable origin.

### Stable custom domain / named Cloudflare Tunnel

```bash
mso gateway domain set https://mso.example.com
```

The command validates a clean HTTPS origin, atomically updates only `OS_PUBLIC_ORIGIN` in
`.env.local`, and prints a named-tunnel ingress example whose upstream remains loopback. Create the
Cloudflare tunnel/DNS credentials using Cloudflare's official CLI, then start it without putting a
token on the command line:

```bash
mso gateway start --config ~/.cloudflared/config.yml --tunnel mso
mso web
```

The config must be a regular file owned by the current user and must not be group/world-writable.
MSO parses it before launch and requires exactly one ingress hostname matching `OS_PUBLIC_ORIGIN`
that points to the configured MSO loopback port, followed by `http_status:404`; its
`credentials-file` must be a private owner-owned regular file. This prevents a config intended for
MSO from silently publishing other laptop services. For a permanent Internet-facing control plane,
add Cloudflare Access/WAF policy (or equivalent) in front of MSO in addition to MSO's password +
approved-device gate. Rebuild/restart MSO after
changing stable origin or split-host environment configuration.

### Tailscale (recommended)

Keep MSO on loopback and publish it with Tailscale Serve so the browser reaches an HTTPS
origin.

### Caddy/nginx/Traefik

Terminate TLS at the reverse proxy and forward to `127.0.0.1:4005`. Preserve the real host
and client IP headers consistently. Set `OS_PUBLIC_ORIGIN=https://mso.example.com` when a
reverse proxy is the stable public origin; MCP discovery and managed-app CSP use it as
deployment-owned authority.

Do not bind `0.0.0.0` merely because a reverse proxy exists. Bind wider only when the host
firewall/network design explicitly requires it.

## 3. Authentication and device roles

If installing manually, copy `.env.example` to `.env.local` and set at minimum:

```dotenv
OS_LOGIN_PASSWORD=choose-a-strong-owner-password
OS_SESSION_SECRET=<stable random 32+ byte secret>
```

The first correct login from a browser creates a **pending device**. Bootstrap an Owner from the
server, then approve additional devices from Settings → Devices or the CLI:

```bash
mso device approve <device-id> "owner laptop" --role owner
mso device approve <device-id> "read-only tablet" --role viewer
mso device role <device-id> operator
```

Viewer is read-oriented; Operator adds bounded managed-app/Camoufox/service operations; Owner has
write, Terminal/exec, credential, device, MCP and update authority. Web approvals default to Viewer.
Role changes are resolved from the private device store on every request, so they do not wait for the
session cookie to expire. The local CLI remains the recovery path if browser Owners are lost.

These roles are tied to approved devices under one deployment password and one Unix service user.
They are not named-user accounts, Linux-user switching, OIDC/SSO, or tenant isolation. Shared Appearance, Theme and Quicklinks remain deployment-wide; delegated devices read/use them and Owner edits them.

Changing `OS_SESSION_SECRET` invalidates all existing browser sessions while leaving the device
allowlist and its roles intact.

## 4. Filesystem roots

Defaults allow the owner's home/project area. Override deliberately:

```dotenv
OS_FS_READ_ROOTS=~:~/projects
OS_FS_WRITE_ROOTS=~:~/projects
```

`OS_FS_READ_ROOTS=/` permits broad **read** browsing subject to the process user's Unix
permissions, but write roots should stay narrow. The credential denylist still blocks MSO's
private state, `.env*`, SSH/GPG paths and other sensitive-home material.

## 5. Service model

The installed production process is a normal systemd system unit running as the non-root
owner, with its working directory set to the checkout and `.env.local` loaded as the
environment file.

The installer also sets `XDG_RUNTIME_DIR=/run/user/<uid>` and enables user lingering. This
is required because MSO itself controls systemd **user** units such as Camoufox and managed
applications; without a persistent user manager those calls look like "not installed" even
when the application exists.

Production health is:

```text
GET /api/health -> {status, buildId, uptime, version}
```

### Service Center policy

System Monitor can inventory system and user services without extra configuration. Inventory is
read-only. Journal access needs Operator/Owner, and lifecycle is disabled until an Owner adds exact
entries—no wildcards—to `.env.local`:

```dotenv
OS_SERVICE_CONTROL_UNITS=user:mso.service,system:nginx.service
```

User-unit actions use the owner's user systemd bus. System-unit actions use the process user's
normal permission by default. Only when deliberately configured may MSO invoke non-interactive
sudo:

```dotenv
OS_SERVICE_CONTROL_USE_SUDO=1
```

If that flag is used, grant only the exact `systemctl` actions/units required; do not give the MSO
user broad passwordless sudo. The application allowlist is an additional control, not a replacement
for Unix/sudo policy. Advanced binary overrides (`MSO_SYSTEMCTL_BIN`, `MSO_JOURNALCTL_BIN`,
`MSO_SUDO_BIN`) exist for unusual installations/testing and should normally stay unset.

The Updates tab is visibility-only. It reads the supported package manager's **existing local
cache** and does not refresh repositories, install packages, or upgrade the host. Optional manager
and binary overrides are documented in `.env.example`; normal installations should use detection.

## 6. Optional Browser app — Camoufox

The current Browser app is **Camoufox**, not the retired Playwright browser daemon.
`scripts/camoufox-vnc-service` launches:

```text
Xvfb -> matchbox window manager -> Camoufox -> x11vnc -> websockify/noVNC
```

The service should be a systemd **user** unit named `camoufox-vnc.service`. It is intended
to stay **disabled at boot**, with `Restart=no` and a finite runtime lease; the Browser UI
powers it on only when needed.

The noVNC document is never served on the cockpit origin. Configure
`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` plus `OS_SESSION_COOKIE_DOMAIN`, provision the reserved
viewer host (for example `camoufox.mso.example.com`) with DNS/TLS, and keep
`CAMOUFOX_NOVNC_URL` loopback-only. The historical `/camoufox-vnc/*` route intentionally returns
404; the dedicated host strips cockpit cookies and authorization before forwarding to noVNC.

Important paths/defaults:

- persistent logged-in profile:
  `~/.local/share/camoufox/profiles/linkedin`;
- VNC password file: `~/.vnc/passwd`;
- rolling login/session safety snapshots:
  `~/.local/state/camoufox/session-backup/`;
- runtime noVNC overlay: under `XDG_RUNTIME_DIR` and recreated each start.

The profile can contain live Google/LinkedIn cookies. Keep the profile and session backups
private (`0700` parent tree) and do **not** add them to an ordinary broad backup without
considering the account-takeover impact of a stolen cookie database.

The old `os-browser/` directory that remains in this checkout is development/test tooling
because it carries the Playwright dependency. It is not a production browser service and
uses none of the old `OS_BROWSER_*` runtime configuration.

## 7. Optional Alfa AI

Settings → AI can store BYOK provider credentials in private host config. Common built-ins
include Anthropic/OpenAI/OpenRouter/Google/Groq/xAI/DeepSeek/Mistral; custom compatible
endpoints are supported and SSRF-checked.

The optional `openai-codex` provider uses a separate ChatGPT consumer OAuth/device flow for
Alfa inference. It is unrelated to the ChatGPT MCP connector. See
`docs/MODELS-INTEGRATION.md`.

## 8. Curated skill installation

MSO distinguishes **discovery** from **installation**. `mso skills list/search/read` inspect
the live trusted/discovered catalog. The curated market is a smaller committed review set:

```bash
mso skills available
mso skills info ponytail
mso skills install ponytail caveman rtk -y
mso skills remove ponytail -y
```

Market packages are pinned in `skill-market/catalog.json`. The installer verifies the
committed `SKILL.md` SHA-256 and frontmatter before copying it to `~/.mso/skills/<id>`
(override only for CLI/operator workflows with `MSO_SKILL_INSTALL_ROOT`), then writes
`.mso-market.json` provenance. `-y` makes a selected normal install/removal
non-interactive, but it does **not** overwrite a modified/local skill; replacement requires
`--force` explicitly. Removal also refuses directories without MSO market provenance.

Ponytail and Caveman are pinned reviewed snapshots. `rtk` is deliberately an MSO-safe
wrapper rather than the current upstream RTK Integration package: the upstream scan warns
about automatically executing an unpinned remote installer and editing shell profiles. The
MSO wrapper only teaches use of an already-installed RTK binary and requires a separate
explicit request for system installation/hooks.

## 9. Optional MCP / ChatGPT custom app

MCP is **off by default**. Enable it only for a deployment that needs external AI clients:

```dotenv
OS_MCP_ENABLED=1
OS_MCP_MAX_SCOPE=read   # raise to write/exec only when required
```

Use `docs/CHATGPT-PLUGIN.md` for ChatGPT setup and diagrams, and `docs/MCP.md` for the
complete protocol/security model. After changing the MCP toolset, refresh/re-scan the
ChatGPT app; MSO's "Mark ChatGPT refreshed" button is only a local acknowledgement.

## 10. Optional managed-app dashboards

Hermes, OpenClaw and 9Router lifecycle management works without a domain. A configured 9Router
application URL is preferred for its in-shell UI. Without one, 9Router stays loopback-only unless
the owner explicitly sets `NINE_ROUTER_EXPOSE_PUBLIC=1` and accepts the firewall/authentication
consequences. Hermes/OpenClaw remain loopback-only unless an operator adds an external route.

The safe default is no vendor dashboard on the **MSO cockpit origin**. To opt into
split-origin embedding, configure:

```dotenv
NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE={id}.mso.example.com
OS_SESSION_COOKIE_DOMAIN=.mso.example.com
OS_PUBLIC_ORIGIN=https://mso.example.com
```

Provision DNS/TLS only for explicit hostnames you intend to embed (`hermes`, `openclaw`,
and optionally `9router`) and sign out/in after changing the cookie domain. These records
are optional and are not created by managed-app install. There is no supported same-origin
iframe fallback. See `docs/MANAGED-APPS.md` and `docs/9ROUTER-INTEGRATION.md`.

## 11. Public demo mode

A public showcase must be a separate checkout/service built with:

```bash
NEXT_PUBLIC_OS_DEMO=1 bun run build
```

Demo mode is mock-only: no normal owner auth, no live host API, no real PTY/exec, no MCP and
no API-key storage. Do not toggle demo mode in the production owner checkout.

## 12. Updating

### Operator update

Use Settings → About or:

```bash
mso update status     # fetch + show incoming CLI version/commits
mso update            # preferred: update safely even if :4005 is down
mso update log
```

The updater verifies the incoming checkout/build before replacing the service. With an active
`mso.service` it first canonicalizes the unit's `WorkingDirectory` and requires it to equal the checkout
that invoked `mso update`; a secondary clone is never allowed to restart an unrelated live service.
The updater then runs outside that service cgroup so it survives the restart. With no active
service (including WSL without systemd), it performs the clean fast-forward/dependency/verify/build
path locally. If `mso web`/gateway owns the detached Next runtime, update first quiesces only that
verified runtime, leaves an active tunnel identity intact, rebuilds, then restores the runtime. A
private deployment receipt and restart marker mean a dependency/build failure after Git already
reached `origin/main` is retried by the next ordinary `mso update` instead of being mislabeled
"already up to date". Interactive CLI commands also show a throttled Git-backed update notice;
the notice never depends on port 4005. A successful service finalizer log ends with `UPDATE OK`.

If the installed source is correct but the production build tree is inconsistent, use:

```bash
mso update --rebuild
```

### Developer release

After code/docs changes and verification:

```bash
bun run ship "feat(scope): describe the verified change"
```

The command updates the generated changelog, runs pre-push gates (including an out-of-tree
production build), pushes the exact commit, then performs the in-place build/replacement and
post-deploy chunk verification. When started through MCP, finalization is handed to the
owner user manager so replacing MSO cannot kill its own deploy controller.

A Git push by itself is **not** a production deployment.

## 13. Rollback

Prefer an explicit known-good Git commit and the same verified rebuild/update machinery,
not ad-hoc partial `.next` changes. Keep the old running process alive if the candidate
build itself fails.

For a live chunk mismatch after the source ref is already correct, `mso update --rebuild`
is the supported recovery path. Verify `/api/health` and `scripts/post-deploy-smoke.sh`
afterward.

## 14. Backups and persistence

MSO owner-local state under `~/.mso/` includes:

- approved devices and their Viewer/Operator/Owner roles;
- AI/provider configuration;
- MCP OAuth client/token hashes;
- audit/activity/workflow memory;
- managed-app snapshots under `~/.mso/backups/`.

Back up `~/.mso` with the same care as credentials. Managed-app snapshots can contain the
managed application's secrets and are not encrypted by MSO.

Camoufox login state is **not** under `~/.mso`; it lives in the local-share/local-state
paths documented above and is even more sensitive because it can contain reusable session
cookies.

Rotate/retain `~/.mso/audit.log` with normal host log management. Inspect logs before
sharing them because command/path context may be private.

## 15. Uninstall

The supported installer uninstall removes the MSO systemd unit but deliberately keeps the
checkout and `~/.mso` data:

```bash
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash -s -- --uninstall
```

Delete code/private state only as a separate deliberate owner action after deciding what to
retain. Camoufox is a separate user service/profile and is not silently deleted by the MSO
installer.

## 16. Verification checklist

After install/update:

1. service is active;
2. local and public `/api/health` report the expected build id;
3. login works on an approved browser over HTTPS/localhost;
4. `scripts/post-deploy-smoke.sh` passes;
5. if UI changed, test desktop + phone portrait + phone landscape;
6. if MCP changed, compare Settings → MCP signature and refresh the external app/tool
   snapshot;
7. if managed-app origins changed, sign in again and test each explicit app hostname;
8. test Viewer/Operator/Owner route behaviour on separate devices when authorization changed;
9. if Service Center changed, prove inventory, bounded logs, allowlist refusal/action and cache-only package visibility.
