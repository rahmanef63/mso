# Automatic managed-application domains

MSO can provision an exact subdomain when a managed application is installed,
updated, started or restarted. Configure the domain once on the MSO host, then use:

```bash
mso mapp enable 9router
```

`enable` installs an absent application, waits for its persisted install job, and
starts it through the existing managed-app API. It also works for `hermes` and
`openclaw`. An installed application is retained. Install options such as
`backend=docker` are accepted only when an installation is actually needed.

## One-time setup

The initial provider is Cloudflare. Use an existing Cloudflare zone and an existing
tunnel already serving the MSO cockpit. Both remotely managed tunnels and named
local tunnels owned by `mso gateway` are supported. The local adapter refuses a
tunnel owned by another supervisor instead of adopting or migrating it.

In local mode, both the connector's launch argument and its YAML `tunnel` field
must identify the exact tunnel UUID. A launch using an unverified tunnel-name alias
is refused. A route update waits for the replacement connector to register before
retiring the previous one; it preserves the running MSO process and records enough
identity information to recover an interrupted replacement safely.

Choose an existing named integration user and Cloudflare connection. Enter the API
token through MSO's private Integrations setup form; never pass a token to a domain
command. The connection needs Zone Read, DNS Edit and Cloudflare Tunnel Edit for
the selected zone/account. A connector runtime token alone does not grant DNS access.

```bash
mso integrations users
mso integrations connections <user> cloudflare
mso integrations setup <user> cloudflare <connection>

# Preview the discovered zone, account, tunnel and public environment settings.
mso domain setup --user <user> --connection <connection> \
  --origin https://mso.example.com \
  --template '{id}.mso.example.com'

# Save the same setup and the two public environment settings.
mso domain setup --user <user> --connection <connection> \
  --origin https://mso.example.com \
  --template '{id}.mso.example.com' --apply

# Activate the build-time app host template through the supported deployment path.
mso deploy
mso mapp enable 9router
```

For a host with no active `mso.service`, use its supported offline update/rebuild
path (`mso update --rebuild`) to activate the template. See
[`DEVELOPMENT.md`](./DEVELOPMENT.md) and the gateway deployment contract.

`--origin` defaults to `OS_PUBLIC_ORIGIN`. The template defaults to the existing
`NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE`, or `{id}.<cockpit-hostname>` when unset.
The CLI resolves the configured MSO loopback port; `--local` can name another clean
HTTP loopback origin. `--zone` pins a zone name/ID, and `--tunnel` supplies the UUID
when the existing cockpit DNS cannot identify one unambiguously. Setup checks that
the zone and tunnel belong to the same Cloudflare account.

The domain commands are local owner operations. Run them on the intended MSO host;
`--base`, `MSO_BASE` and `OS_BASE` are rejected to prevent editing a different machine.
Application lifecycle commands continue to use the authenticated shared MSO API.

## DNS, routes and HTTPS are separate

For the template above, the 9Router hostname is `9router.mso.example.com`.
MSO first confirms that hostname's ingress to the MSO loopback origin, then creates
an exact proxied CNAME to `<tunnel-uuid>.cfargotunnel.com`. It does not route a new
application hostname directly to the vendor container. Existing ingress rules,
origin settings and the final catch-all are preserved. Conflicting DNS or ingress
records are reported for operator review instead of being overwritten.

Before any provider write, the running MSO server must prove it recognizes the
selected app hostname and rejects anonymous app requests. After the route exists,
MSO checks the app's loopback health and verifies the public HTTPS auth gate. A DNS
record alone cannot make the result `ready`.

Cloudflare Universal SSL on a full zone normally covers the apex and first-level
subdomains. A nested name such as `9router.mso.example.com` needs a certificate
covering that name, for example an appropriately issued `*.mso.example.com`
certificate. A flat template such as `{id}-mso.example.com` stays at the first
subdomain level. Cloudflare's Total TLS documentation excludes Tunnel hostnames;
do not assume turning it on solves nested Tunnel certificates. MSO does not
purchase certificates or subscriptions.

Provider references:

- [Universal SSL limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)
- [Total TLS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/total-tls/)
- [Tunnel DNS routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)
- [Remote Tunnel configuration API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/update/)

## Durable state and retries

Setup and progress live outside the source checkout in
`~/.mso/private/managed-domains.json`. `OS_MANAGED_DOMAINS_STORE` can explicitly
override that path. The file is owner-only and contains public routing settings,
named credential references, a stable ownership ID and per-app receipts. Provider
tokens remain in Integrations.

Writes use a cross-process lock, a temporary file and atomic rename. The last valid
snapshot is kept in `managed-domains.json.previous`. A corrupt or unsafe state file
is reported; it is never silently reset. Per-app operations also share a separate
operation lock so simultaneous app starts cannot replace each other's tunnel rules.

| Phase | Meaning |
|---|---|
| `pending` | Desired hostname recorded; provisioning not yet verified |
| `route-ready` | Authenticated ingress confirmed; DNS may still need work |
| `dns-ready` | Exact DNS record confirmed; app health and public HTTPS still need verification |
| `ready` | App health, public HTTPS and anonymous access rejection passed at `verifiedAt` |
| `blocked` | A stage failed; the diagnostic and completed DNS/route receipts are retained |

`ready` is a timestamped verification, not a continuous uptime guarantee. A retry
rechecks existing resources and repairs only the declared app route. A timeout,
lost response or process restart does not require inventing a new hostname.

```bash
mso domain status
mso domain doctor 9router
mso domain ensure 9router          # read-only checks/preview
mso domain ensure 9router --apply  # resume or reconcile
```

Automatic provisioning is enabled by setup. `--manual` saves the same settings but
requires explicit `ensure --apply` calls. Install/update success remains an
application result; a separate redacted domain diagnostic is kept in the job log
and managed-app view. `mso mapp enable/start/restart` returns exit code 2 when that
result needs domain attention. `mso domain ensure --apply` and `doctor` return 2
when the domain is not ready; invalid commands, malformed state and setup errors
return 1.

## Recover unfinished configuration

If setup saved the routing state but the environment update or deployment was
interrupted, regenerate the public environment settings from the saved state:

```bash
mso domain repair-env
mso domain repair-env --apply
mso deploy                         # or the supported offline rebuild on a fallback host
mso domain ensure 9router --apply
```

Only `OS_PUBLIC_ORIGIN` and `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` are updated in
the selected env file. Other settings and secrets are preserved. Their values are
not printed. If the state file itself is corrupt or missing, preview and restore
the last valid private snapshot:

```bash
mso domain restore
mso domain restore --apply
mso domain repair-env --apply
```

Changing an already saved zone, account, tunnel or hostname template is a migration.
Setup refuses to silently rebind those resources. Preserve the existing routes and
plan the migration explicitly. Stop/uninstall does not delete DNS, tunnel ingress,
certificates or saved domain state.

## Authentication and application prerequisites

The browser opens an app through MSO and exchanges a short-lived, app-bound ticket
for a host-only app cookie. `OS_SESSION_COOKIE_DOMAIN` is obsolete and is not part
of setup. Cockpit cookies and provider credentials are never forwarded to the app.
See [`MANAGED-APPS.md`](./MANAGED-APPS.md) for HTTP/WebSocket authorization.

9Router still requires an accessible Docker daemon and remains loopback-bound by
default. Domain automation cannot replace a missing application runtime, authorize
a Cloudflare connection, or make a certificate cover a hostname. The diagnostic
names the missing stage so setup can continue from the existing saved work.
