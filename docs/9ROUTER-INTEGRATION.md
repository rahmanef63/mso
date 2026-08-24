# 9Router integration

9Router is a managed application in MSO. This document defines the server/VPS contract so
future changes do not confuse its upstream npm CLI, Docker runtime, public access, and
optional MSO dashboard proxy.

## Distribution choice

Upstream publishes both:

- npm CLI: `npm install -g 9router` then `9router`;
- Docker: `decolua/9router:latest` with port `20128` and persistent `/app/data`.

MSO uses **Docker for the managed server runtime**. The upstream README recommends Docker for
server/VPS use, and one owner avoids running two 9Router servers against the same port/data.
`scripts/managed-app-9router` is MSO's adapter for install/update/status/uninstall; it is not
evidence that upstream lacks a CLI.

## Runtime contract

Default container:

```text
name: 9router
image: decolua/9router:latest
restart: unless-stopped
host port: 20128 -> container 20128
state: ~/.9router -> /app/data
DATA_DIR: /app/data
health: GET http://127.0.0.1:20128/api/health
version/update check: GET http://127.0.0.1:20128/api/version
```

MSO uses loopback for trusted internal health/version calls even though Docker publishes the
port publicly.

## Public-IP-first UI

A 9Router installation must not depend on a domain. When MSO sees a globally-routable IPv4
on the host, its managed-app view advertises:

```text
http://<public-ip>:20128
```

The MSO 9Router window offers **UI / CLI**. UI opens that direct URL in a dedicated tab. It
is intentionally not put in an HTTPS iframe because browsers block HTTP mixed content.
Because the direct URL is a different origin, vendor JavaScript also cannot inherit the MSO
cockpit origin/session.

A custom domain is optional. Hostinger/Cloudflare automation may later configure DNS/TLS,
but it is not part of install health and must never be assumed to exist.

## Optional split-origin embedding

If an operator wants 9Router embedded inside an HTTPS MSO window, use the same explicit
split-origin contract as other vendor dashboards:

```dotenv
NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE={id}.mso.example.com
OS_SESSION_COOKIE_DOMAIN=.mso.example.com
OS_PUBLIC_ORIGIN=https://mso.example.com
```

Then create only the explicit `9router.mso.example.com` DNS/TLS route and re-authenticate so
the widened session cookie is actually issued. This path is optional; a failing split-origin
hostname must not make the running 9Router app appear unavailable.

An older standalone hostname such as `9-router.example.com` may continue proxying directly
to port 20128. MSO does not need to delete or replace it when enabling managed-app support.

## CLI view

Do not auto-run any of these in the MSO terminal:

```text
9router          # starts a server
9router status   # not an upstream command
```

For the MSO-owned Docker runtime the safe opening command is:

```bash
docker logs --tail 80 9router
```

The terminal remains interactive afterwards. The upstream npm CLI can still be used
manually for its documented subcommands when an operator intentionally installed it, but it
is not MSO's server lifecycle authority.

## Lifecycle

- **Install**: pull image, create data directory, run container, wait for `/api/health`.
- **Start/stop/restart**: Docker lifecycle against the detected `9router` container.
- **Update check**: app `/api/version` response.
- **Update**: pre-update MSO state backup, pull image, recreate container, preserve data
  mount, wait for health.
- **Uninstall preview**: reports the container that would be removed and state/image kept.
- **Uninstall**: remove the container only. `~/.9router` and image remain.
- **Restore**: uses the normal managed-app state snapshot rules while the app is stopped.

## Verification

On a server where 9Router is installed:

```bash
./scripts/managed-app-9router --version
./scripts/managed-app-9router check --json
./scripts/managed-app-9router status
./scripts/managed-app-9router uninstall --yes --dry-run
curl -fsS http://127.0.0.1:20128/api/health
```

For a public-IP installation also confirm the public address responds from the intended
network. A local curl to the public address proves binding/routing on the host but does not
prove an upstream cloud firewall permits arbitrary external clients.

## Failure map

- **Old standalone domain works, new `9router.mso...` does not**: 9Router itself is likely
  fine. Check direct public-IP access first. The new name is an MSO split-origin concern
  (DNS/TLS + cookie domain + re-login), not an application-health dependency.
- **`401` only on the split-origin host**: verify the MSO session cookie was re-issued with
  the configured cookie domain; a curl without an authenticated cookie will also get 401.
- **`/health` says 404**: expected endpoint is `/api/health`.
- **npm update fails with ownership errors after Docker use**: do not mix npm-owned runtime
  updates with the Docker-managed `~/.9router` server state. Keep Docker as the VPS owner.
