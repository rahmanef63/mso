# Troubleshooting

> **Current reference.** Symptoms → likely cause → supported recovery. Historical browser
> sidecar and manual deploy instructions are intentionally not used here.

## Login & sessions

### Login returns `not_configured` (HTTP 500)

`OS_SESSION_SECRET` is missing/too short or `OS_LOGIN_PASSWORD` is invalid. MSO fails
closed. Fix `.env.local`, then restart through your normal service/update path.

### "Too many attempts, try again later" (HTTP 429)

The per-IP login limiter tripped. Wait for the window to pass. Behind a reverse proxy,
forward the real client IP consistently so every user does not share the proxy address.

### Correct password but "pending approval"

Expected for a new browser. Approve the shown device id from an already-approved browser
(Settings → Devices) or from the server using the approval script.

### `mso onboard` approved the CLI device, then says port 4005 is unreachable

Device approval and runtime liveness are separate. Current MSO does not tell you to approve the same
device again for a connection failure: on loopback, onboarding asks the gateway runtime helper to
verify the MSO health contract and, on WSL/no-service installs, start the already-built production
runtime on loopback. If the build is missing or stale, run `mso update`, then `mso web`, then resume
`mso onboard`. Running `mso device approve <id>` again with the same role is idempotent; changing an
existing device role still requires the explicit `mso device role` command.

### How do I update when the web UI / port 4005 is down?

Run `mso update`. The CLI updater reads/fetches `origin/main` directly and does not need the MSO API.
On WSL without an active service it verifies and builds the clean updated checkout. Every gateway-owned fallback runtime for that canonical checkout is inventoried and quiesced before `.next` changes, then restored afterward while active tunnel identities are preserved. Checkout-scoped private deployment receipts/restart markers
survive partial failures, so rerunning the same `mso update` retries dependency/build/restart work even
when Git HEAD already equals `origin/main`. Offline transactions are serialized; do not remove the
owner-only update-state directory just to bypass a pending recovery. Recovery intent is written before
a gateway-owned runtime is quiesced, so an interrupted state update remains safely retryable. Use
`mso update status` for source/deployment state and `mso update log` for the service-updater transcript.
When `mso.service` is active, status also compares the commit baked into the live loopback `/api/health`
response with source `HEAD`; source equality alone is not treated as proof that deployment finished.

### `mso update` says the active service belongs to another checkout

This is a safety refusal. A machine may contain multiple MSO clones, but an active `mso.service` has
one canonical `WorkingDirectory`. Run the update from that checkout (normally the directory targeted
by the installer) instead of letting a secondary clone rebuild itself and restart someone else's unit.

### `mso update` says the selected loopback runtime is not safely update-owned

MSO found a healthy loopback responder while `mso.service` is inactive, but that process is not
recorded as a gateway-owned fallback runtime. This is commonly a manual `bun run start`/`next start`.
Stop that manual runtime first, then rerun `mso update`. MSO refuses here before dependency or `.next`
mutation rather than rebuilding underneath a process that is actively serving the old build.

### `mso gateway start` says an offline update is mutating this checkout

This is an intentional safety exclusion. Every in-place `mso update` (service-active or offline) holds the checkout-wide runtime lock while `.next` can change, so `mso web`, onboarding fallback, and gateway runtime recovery cannot start
Next from a partially-mutated build. Let the update finish, then rerun the same gateway/web command.

### `mso gateway start` cannot install or verify cloudflared

Current MSO installs a reviewed `cloudflared` release automatically into `~/.mso/tools` on first
`mso gateway start`. The release URL and SHA-256 for supported Linux architectures are pinned in
`security/gateway-artifacts.env`; the cached binary is re-hashed before reuse and auto-update is
disabled. Run `mso gateway install` to retry the dependency step by itself. If outbound GitHub
release downloads are blocked, fix that network policy or set `MSO_GATEWAY_CLOUDFLARED` to an
explicit locally reviewed executable. Set `MSO_GATEWAY_NO_AUTO_INSTALL=1` when policy requires
manual provisioning.
A brand-new Quick Tunnel hostname may also take several seconds to become reachable. `mso gateway
start` waits up to 60 seconds by default and still requires the exact MSO health/runtime-instance
contract; this is readiness tolerance, not a weaker health check. A local resolver can cache the
initial NXDOMAIN longer than the record creation itself; temporary mode therefore has a Cloudflare
DoH fallback that still verifies HTTPS for the generated hostname and the exact runtime nonce.

### `mso gateway` misdetects local health when my shell uses an HTTP proxy

Current MSO explicitly bypasses configured HTTP/HTTPS proxies for the already-validated loopback
`/api/health` probe. Public HTTPS readiness still follows normal proxy policy. If `mso gateway doctor`
still cannot verify the local runtime, inspect the local bind/build rather than adding the public
Quick Tunnel hostname to `NO_PROXY`.

### Temporary gateway opens, but Terminal does not stream

Cloudflare Quick Tunnels are the no-custom-domain preview mode and do not support Server-Sent
Events. MSO Terminal output is an SSE stream, so use a named Cloudflare Tunnel/stable HTTPS origin
for full Terminal behavior. `mso gateway status` labels a Quick Tunnel as temporary.

### `mso gateway stop` leaves my manually-started MSO runtime running

Expected. The gateway only stops a Next runtime when it launched that exact loopback process and
recorded it as gateway-owned. An existing systemd/manual runtime is outside the gateway lifecycle.
This prevents `stop` from terminating an unrelated or pre-existing process.

### Login returns success but the browser is logged out immediately

The session cookie is `Secure`. Plain HTTP on a normal IP/hostname causes browsers to drop
it. Use HTTPS/Tailscale Serve or access through a localhost SSH tunnel.

### Existing sessions suddenly died

A changed `OS_SESSION_SECRET` invalidates all signed sessions. Confirm deployment automation
is not regenerating it.

## Deploy & build

### UI is unstyled or JS/CSS chunks 404 after deploy

The running `next start` process and on-disk `.next` tree do not match. Do **not** keep
mutating the live `.next` tree manually. After any active updater/finalizer has finished,
run the supported recovery rebuild:

```bash
mso update --rebuild
```

Then verify `/api/health` and run the post-deploy smoke check. Developer changes should be
released with `bun run ship "<conventional commit>"`, which performs the verified
build/restart sequence.

### Build runs out of memory

A Next production build can need multiple GiB. Add swap or raise the Node heap for the
build process, then run the supported build/release path again. Do not restart a healthy
old service after a failed build.

### "Another next build process is already running"

First confirm a release/self-update is not actually active. Multiple simultaneous builds
against the production checkout are unsafe. If no process owns the build and only a stale
lock remains, remove the stale lock, then use the normal update/release command.

### A new route still 404s after deployment

Confirm Git `HEAD`, `origin/main`, `/api/health` build id and the deployment log all refer to
the expected release. If the deployment is correct but the build tree is inconsistent, use
`mso update --rebuild` rather than hand-restarting around a partial build.

### Update button says a newer version exists forever

Check Settings → About and `~/.mso/self-update.log`. A successful self-update ends with
`UPDATE OK`. Also verify only one production process is serving the public origin. If the
browser cached an old service worker, unregister it once and hard reload after the server is
confirmed healthy.

## Files

### "Folder is outside the writable area"

The target is outside `OS_FS_WRITE_ROOTS`. Widen the write jail deliberately in
`.env.local` if needed; do not use the sensitive-path escape hatch as a convenience.

### Folder tree cannot see an expected path

Reads are bounded by `OS_FS_READ_ROOTS` plus the process user's Unix permissions. Credential
paths remain hidden even when they are physically beneath an allowed root.

### "Access to credential files is blocked"

Expected. MSO blocks its own private state, `.env*` and sensitive-home paths through the
normal file API. Edit such material through a trusted host-admin channel rather than
teaching the web file manager to read it.

## Terminal / Code integrated terminal

### Terminal says too many sessions

MSO caps concurrent live PTYs. Close unused tabs. Normal page/tab navigation sends a close,
and stale detached shells can be reclaimed after a grace period when capacity is exhausted;
attached active terminals are not reclaimed to make room.

### Terminal disappears after server restart

PTYs are processes, not persisted sessions. A server restart terminates them. The client
can open a fresh shell; command history/persistent work should live in the shell/tool itself
(e.g. files, tmux when intentionally used), not PTY memory.

### Code editor Terminal button works but starts in the wrong directory

Integrated Code Terminal uses the editor/project working directory passed as `cwd`. Confirm
the opened file/project path is inside an allowed writable root; otherwise host cwd
resolution falls back/refuses according to the host policy.

## Camoufox Browser

### Browser says Camoufox is not installed

The current Browser app uses the `camoufox-vnc.service` **user unit** plus
`scripts/camoufox-vnc-service`. The retired Playwright browser daemon and
`OS_BROWSER_URL`/`OS_BROWSER_SECRET` are not part of current MSO.

Check the prerequisites documented in `docs/INSTALL.md`: Camoufox, a headless X server,
x11vnc, noVNC/websockify, the VNC password file and the user systemd runtime/linger setup.

### Browser is installed but Off

That is the expected idle state. The user unit is intentionally not enabled at boot and has
a finite lease. Start it from Browser/Settings; stop it again when done.

### Browser reports secure embedding is unavailable

The Browser requires a reserved split-origin host. Configure
`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` and `OS_SESSION_COOKIE_DOMAIN`, then provision DNS/TLS
for the resolved Camoufox host (for example `camoufox.mso.example.com`). Do not restore the old
same-origin `/camoufox-vnc/*` route; it is a deliberate 404 security boundary.

### noVNC loads but the viewer reports missing metadata/assets

MSO's launcher builds a private runtime noVNC webroot that symlinks the distribution assets
and provides the package metadata Debian omits. Restart the Camoufox session so the runtime
webroot is rebuilt from the installed noVNC package.

### Camoufox starts with no saved logins

Verify `CAMOUFOX_PROFILE` points at the persistent profile under the user's local share tree,
not a cache directory. Stop the session before restoring the profile/session backup. Treat
the profile as account credentials: it can contain live cookies.

### Browser is slow on mobile

The app is a real remote Firefox canvas, not a responsive website renderer. MSO's container
is responsive, but the remote browser itself still has a desktop viewport. Use landscape or
zoom/pan as appropriate; do not "fix" it by exposing VNC credentials to the client model.

## Managed applications

### A managed app is reported "not installed" but you know it exists

Look for the diagnostic that says MSO cannot reach the owner systemd user bus. Detection
fails closed for install/restore because rerunning an installer or restoring over a live
unknown service is unsafe. Fix the user bus/linger/service environment first.

### Installed app is stopped and shows no dashboard

Expected. MSO mounts the vendor dashboard only when there is a live upstream. Start the app;
management/log/update actions remain under Details.

### 9Router is healthy, the old hostname works, but a new `9router.mso...` host does not

Verify the loopback dashboard first (`curl http://127.0.0.1:20128/api/version`). The
`*.mso...` route belongs to optional split-origin embedding and has independent DNS/TLS,
`OS_SESSION_COOKIE_DOMAIN`, build-time host-template and re-login requirements. A `401` from
that host does not mean the 9Router container is down.

### App is healthy but dashboard is not embedded

Embedded dashboards are opt-in. Confirm
`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` and `OS_SESSION_COOKIE_DOMAIN`, DNS/TLS for the
explicit app hosts, and sign in again after changing the cookie domain. With those variables
unset, no vendor iframe is served by design. A direct 9Router public-IP UI exists only when
`NINE_ROUTER_EXPOSE_PUBLIC=1` was deliberately configured.

### Update fails before invoking the upstream updater

The mandatory MSO pre-update state snapshot failed. Fix that first; the update is designed
to abort before changing the app if it cannot create its recovery point.

### Restore is refused

The app must be stopped and MSO must be able to prove that. The backup manifest/source and
current state directory must match, and symlink collisions are rejected before writes.
Follow the specific refusal instead of bypassing the guard.

## Alfa / model providers

### Alfa says no API key/provider configured

Configure a BYOK provider in Settings → AI, set the corresponding server environment key,
or intentionally connect the optional `openai-codex` provider. These are model credentials,
not MCP credentials.

### Custom provider URL is rejected

MSO SSRF-checks custom base URLs and refuses private/link-local/unsafe destinations according
to its custom-provider policy. Use a legitimate endpoint reachable under that policy.

### OpenAI Codex sign-in and ChatGPT MCP are being confused

They are different flows. `openai-codex` under Settings → AI is an Alfa inference provider.
The ChatGPT custom MCP app authorizes ChatGPT to call MSO tools through MSO's `/oauth/*`.
See `docs/MODELS-INTEGRATION.md` and `docs/CHATGPT-PLUGIN.md`.

## MCP / ChatGPT custom app

### `/mcp` or OAuth discovery returns 404

`OS_MCP_ENABLED=1` is not active in the running service (or demo mode forced MCP off).
After changing config, use the supported rebuild/update path and recheck `GET /mcp`.

### ChatGPT says the MCP server does not support OAuth

Check both well-known endpoints from the same public origin ChatGPT reaches. A 404 normally
means MCP is disabled in the running MSO process.

### OAuth opens but cannot complete

The consent page is a normal MSO browser page. Use an already-approved device and active
MSO session, review the requested `read/write/exec` tier, then Allow.

### ChatGPT still shows old tools after MSO changed

Compare Settings → MCP toolset version/hash/count, refresh/recreate the ChatGPT custom MCP
app, and run Scan Tools. "Mark ChatGPT refreshed" in MSO is only an acknowledgement; it
does not refresh ChatGPT remotely.

### Tool exists but returns scope denied

The OAuth bearer was granted below that tool's tier. Reauthorize intentionally at the needed
scope rather than raising `OS_MCP_MAX_SCOPE` blindly.

### `fs_upload_file` fails

The bridge accepts a current ChatGPT-provided file reference, up to 20 MiB, and writes only
inside `OS_FS_WRITE_ROOTS`. Temporary OpenAI download URLs expire and are host/type/redirect
validated. Reattach/regenerate the file instead of supplying an arbitrary public URL.

### Project/skill seems missing

Check the scan report. Project and skill enumeration are bounded; if `truncated:true`,
continue with the returned cursor instead of concluding absence.

## Where to look next

- release/update: `docs/DEVELOPMENT.md`, `docs/INSTALL.md`
- ChatGPT connector: `docs/CHATGPT-PLUGIN.md`, `docs/MCP.md`
- managed apps: `docs/MANAGED-APPS.md`
- Camoufox: `claude-skills/mso-camoufox/SKILL.md`
- security: `SECURITY.md`
