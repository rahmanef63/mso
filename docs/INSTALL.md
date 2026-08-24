# Installing MSO on a Linux server

> **Current reference.** The one-command installer is the supported path for a normal
> deployment. Manual commands below explain the model and recovery boundaries; release
> developers should use `bun run ship`, while operators update through Settings → About or
> `mso update run`.

## 0. Requirements

- Linux with systemd;
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

The installer:

1. resolves/creates the checkout and records whether this is a fresh install;
2. installs Bun/dependencies as needed;
3. creates private owner auth configuration when missing;
4. runs the production build;
5. installs the `mso.service` system unit when systemd is available;
6. enables the owner's lingering user manager needed by self-update/managed-app user units;
7. installs `~/.local/bin/mso` plus a guarded `/usr/local/bin/mso` launcher so the parent
   shell can resolve `mso` immediately after `curl | bash` returns;
8. persists an idempotent `~/.local/bin` PATH fallback for future shells;
9. starts/replaces the service only after a successful build;
10. on a fresh interactive install, opens `/dev/tty` and launches `mso onboard`.

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

`curl | bash` cannot use stdin for questions because stdin carries the script itself. The
installer therefore prompts through `/dev/tty`. If there is no controlling terminal it
never waits for input and tells the operator to run `mso onboard` later. Re-running the
installer updates an existing installation with the same build-before-replace safety rule
and does not repeat onboarding unless `--onboard` is requested.

### Guided onboarding

Run or resume it at any time:

```bash
mso onboard
```

It first approves the **local CLI device** in the owner allowlist (a process already running
as the owning Unix account has equivalent host authority), then verifies the local service
and session before asking for provider credentials. API keys are read with terminal echo
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

## 2. Network exposure

The installer binds `127.0.0.1` by default. This is intentional: an authenticated MSO owner
session can execute host commands.

For an initial connection, use a localhost tunnel:

```bash
ssh -N -L 4005:127.0.0.1:4005 you@your-server
```

Then open `http://localhost:4005`. A `Secure` cookie is accepted on localhost, but ordinary
plain-HTTP IP/hostnames will drop it.

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

## 3. Owner authentication

If installing manually, copy `.env.example` to `.env.local` and set at minimum:

```dotenv
OS_LOGIN_PASSWORD=choose-a-strong-owner-password
OS_SESSION_SECRET=<stable random 32+ byte secret>
```

The first correct login from a browser creates a **pending device**. Approve the device id
shown on that login screen from the server with `scripts/approve-device.js`. After one
browser is approved, additional devices can be approved in Settings → Devices.

Changing `OS_SESSION_SECRET` invalidates all existing browser sessions while leaving the
device allowlist intact.

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

## 6. Optional Browser app — Camoufox

The current Browser app is **Camoufox**, not the retired Playwright browser daemon.
`scripts/camoufox-vnc-service` launches:

```text
Xvfb -> matchbox window manager -> Camoufox -> x11vnc -> websockify/noVNC
```

The service should be a systemd **user** unit named `camoufox-vnc.service`. It is intended
to stay **disabled at boot**, with `Restart=no` and a finite runtime lease; the Browser UI
powers it on only when needed.

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

Hermes, OpenClaw and 9Router lifecycle management works without a domain. 9Router is
domain-aware on the managed Docker/VPS path: a configured application domain is used as the
in-shell UI; otherwise, after health succeeds, its UI can be opened at `http://<public-ip>:20128`
when the host has a globally-routable IPv4. Hermes/OpenClaw
remain loopback-only unless an operator adds an external route.

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
mso update status
mso update run
mso update log
```

The updater verifies the incoming checkout/build before replacing the service. A successful
finalizer log ends with `UPDATE OK`.

If the installed source is correct but the production build tree is inconsistent, use:

```bash
mso update run --rebuild
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

## 12. Rollback

Prefer an explicit known-good Git commit and the same verified rebuild/update machinery,
not ad-hoc partial `.next` changes. Keep the old running process alive if the candidate
build itself fails.

For a live chunk mismatch after the source ref is already correct, `mso update run --rebuild`
is the supported recovery path. Verify `/api/health` and `scripts/post-deploy-smoke.sh`
afterward.

## 13. Backups and persistence

MSO owner-local state under `~/.mso/` includes:

- approved devices;
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

## 14. Uninstall

The supported installer uninstall removes the MSO systemd unit but deliberately keeps the
checkout and `~/.mso` data:

```bash
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash -s -- --uninstall
```

Delete code/private state only as a separate deliberate owner action after deciding what to
retain. Camoufox is a separate user service/profile and is not silently deleted by the MSO
installer.

## 15. Verification checklist

After install/update:

1. service is active;
2. local and public `/api/health` report the expected build id;
3. login works on an approved browser over HTTPS/localhost;
4. `scripts/post-deploy-smoke.sh` passes;
5. if UI changed, test desktop + phone portrait + phone landscape;
6. if MCP changed, compare Settings → MCP signature and refresh the external app/tool
   snapshot;
7. if managed-app origins changed, sign in again and test each explicit app hostname.
