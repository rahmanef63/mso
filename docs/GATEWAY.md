# MSO Gateway architecture and operations

> **MSO Gateway is deployment-agnostic, supervisor-agnostic, and provider-agnostic by design.**

The gateway core describes health, identity, ownership and lifecycle state. Cloudflare, Tailscale,
ngrok, a reverse proxy, direct HTTPS, systemd, s6, Docker, Kubernetes and similar technologies are
provider/supervisor/deployment choices rather than assumptions in the core state machine.

## Architecture boundary

```text
MSO Gateway Core
  ↓
Provider Adapter
  ↓
Process Supervisor / Runtime
  ↓
Deployment Environment
```

The current managed public adapter is Cloudflare. It remains the default for `mso gateway start`
and keeps the existing Quick Tunnel and named-tunnel safety contract, but Cloudflare-specific binary,
config and launch details stay behind the provider boundary.

Conceptually the core can support:

```text
                  ┌─ Cloudflare Tunnel
                  ├─ Tailscale
Gateway Core ─────├─ ngrok
                  ├─ reverse proxy
                  ├─ direct HTTPS gateway
                  └─ future provider
```

and the lifecycle can be hosted by:

```text
                         ┌─ systemd
                         ├─ s6
Gateway lifecycle ───────├─ Docker / Compose
                         ├─ Kubernetes
                         ├─ external supervisor
                         └─ foreground/manual
```

Adding another managed provider should implement the provider adapter/capability contract rather than
add provider-name branches throughout the core.

## State model

`mso gateway status --json` exposes the provider-neutral state model. Human status preserves the legacy
`gateway: running` line for healthy running states and adds the precise state/dimensions.

| State | Meaning |
|---|---|
| `managed-running` | MSO proves ownership of its provider process and local/public identities match. |
| `external-running` | No MSO-owned provider process exists, but the configured public origin returns the exact selected local MSO identity. |
| `degraded` | A provider/public route exists or is recorded, but local/public/provider health is not fully healthy. |
| `recovering` | MSO has durable managed lifecycle evidence but the recorded provider process is stale/missing and needs safe reconciliation. |
| `stopped` | No owned provider is active and no verified external public route is responding. |
| `unknown` | State is unsafe/corrupt or cannot be classified safely. |

The dimensions are independent:

```text
localHealth
publicHealth
providerHealth
processHealth
ownership
supervisor
```

Example managed state:

```json
{
  "state": "managed-running",
  "ownership": "mso",
  "provider": "cloudflare",
  "supervisor": "mso-lifecycle",
  "localHealth": "healthy",
  "publicHealth": "healthy",
  "providerHealth": "healthy",
  "processHealth": "alive"
}
```

Example external state:

```json
{
  "state": "external-running",
  "ownership": "external",
  "provider": "custom",
  "supervisor": "external",
  "localHealth": "healthy",
  "publicHealth": "healthy",
  "processHealth": "external"
}
```

`provider` is dynamic. `custom` means the public route is verified but MSO does not have enough safe
evidence to name the provider. MSO does not guess provider ownership from a hostname or process name.

## Public health and deployment identity

Process existence is not public readiness. MSO probes the configured public origin at:

```text
https://<public-origin>/api/health
```

It validates the MSO health contract and compares the public health identity with the selected local
runtime. Identity includes `version`, `buildId`, optional `buildSha`, and `runtimeInstanceId`.

Therefore:

```text
local healthy
public HTTP healthy
public identity != local identity
```

is an `identity-mismatch` and produces a degraded state, not a healthy gateway. This catches a valid
hostname that is routing to a different MSO deployment.

Status and doctor are observational. A failed probe does not itself restart a provider. Existing managed
reconciliation remains bounded by proven MSO ownership; external gateways are report-only. This avoids
turning transient edge/DNS failures into restart storms.

## Provider adapter capabilities

The gateway provider boundary reports capabilities instead of making the core branch on provider names.
The current capability vocabulary includes:

```text
publicHealthProbe
managedProcess
namedEndpoint
externalDetection
restart
reconnect
credentialsRequired
dnsRouting
```

Cloudflare currently reports managed-process/restart/reconnect support. A generic external/custom route
reports public-health/external-detection capability but no managed-process/restart authority.

The managed adapter contract is intentionally small: parse/validate start intent, start/reconcile through
its provider implementation, inspect health/state through the generic core, and expose capabilities. Provider-specific
tool/tunnel code is loaded lazily through this boundary, so read-only status/external-route paths do not import the
Cloudflare adapter and generic reconciliation calls the provider probe contract rather than a Cloudflare helper.
This is additive to the existing shell architecture; it is not a new heavyweight plugin framework.

## Managed versus external gateway

### Managed gateway

MSO records and verifies process identity before mutation. Existing protections remain authoritative:

- PID plus kernel process start ticks;
- executable identity;
- command-line identity where stable;
- runtime instance identity for Next;
- owner-private atomic lifecycle state;
- held-child launch handshake;
- checkout/update locks and recovery markers.

`mso gateway stop` terminates only identities proven to be owned by MSO.

### External/unmanaged gateway

When no MSO-owned provider exists but `OS_PUBLIC_ORIGIN` returns the exact local MSO health identity,
status reports `external-running` and `ownership: external`.

For external processes MSO may:

```text
detect       yes
inspect      yes
health check yes
stop         no
restart      no
auto-adopt   no
```

`mso gateway stop` never searches for and kills external tunnel/reverse-proxy processes. There is no
automatic adoption mechanism. Any future adoption feature must be an explicit, separately verified action.

An implicit `mso gateway start` refuses to create a duplicate connector when a verified external route is
already present. An explicit named-provider start remains an operator-directed action and retains its
existing provider validation contract.

## `mso gateway status`

Human-readable status includes the precise state plus provider/ownership/supervisor and health dimensions:

```text
gateway: running
state:   external-running
provider: custom
ownership: external
supervisor: external
process-health: external
local-health:   healthy
public-health:  healthy
provider-health: healthy
public:  https://mso.example.com
local:   http://127.0.0.1:4005
```

Use structured output for automation:

```bash
mso gateway status --json
```

Exit status is `0` for `managed-running` / `external-running`, `1` for `stopped`, and `2` for degraded,
recovering or other non-healthy classified states.

## `mso gateway doctor`

Doctor is read-only. It checks independent dimensions rather than treating Cloudflare availability as the
gateway definition:

- selected local MSO health identity;
- raw application binding/exposure safety;
- configured stable public origin;
- public health contract and identity match;
- lifecycle state and ownership;
- process/provider health classification;
- supervisor context;
- provider-specific diagnostics only when relevant.

The Cloudflare adapter diagnostic never downloads or installs a binary during doctor. Managed installation
remains an explicit `mso gateway install` or managed-start concern.

A public route may be healthy while doctor separately reports an unsafe local bind. For example, a working
reverse proxy does not make `0.0.0.0:4005` safe; the application should normally remain loopback-only.

## Supervisor and deployment model

The core does not require systemd. Application lifecycle, gateway lifecycle, provider lifecycle and host
lifecycle are separate.

### Normal VPS / bare metal

```text
systemd (or another host supervisor)
  → MSO runtime on loopback
chosen gateway provider / reverse proxy
  → public HTTPS origin
```

The standard installer may use systemd when it is actually available, but the gateway state machine does
not derive health/ownership from systemd.

### Container / Docker Compose

```text
container lifecycle
  → MSO foreground runtime on loopback/container-private interface
external or sidecar gateway/reverse proxy
  → public origin
```

Use the container restart policy/orchestrator as the supervisor. MSO can inspect a configured external
public route without claiming its process.

### s6 / external supervisor

```text
s6
  → MSO runtime
  → selected gateway/reverse-proxy lifecycle
```

The supervisor owns its processes; MSO reports `external-running` when the public identity is valid.

### Kubernetes

```text
Pod/container lifecycle
  → MSO runtime
Service/Ingress/Gateway implementation
  → configured public origin
```

Kubernetes owns restart/reconciliation. MSO observes the public identity and does not attempt to kill or
adopt ingress/controller processes.

### WSL / sandbox / remote development

`mso web` continues to support the already-built loopback fallback without requiring systemd. The managed
Cloudflare adapter remains available where its binary/process contract is supported, while an externally
provided route is classified independently.

## Why there is no new `mso gateway supervise` command yet

This refactor does not add a second process-supervision implementation merely for abstraction. Existing
MSO-managed Cloudflare lifecycle stays intact, and systemd/s6/container/Kubernetes/reverse-proxy deployments
are represented safely as externally supervised routes. That is enough to make core health/state portable
without duplicating supervisor semantics.

A future foreground `gateway supervise` should be added only when a managed provider needs one common
signal-aware foreground contract across supervisors. If added, it must use the same provider adapter,
ownership proof, deterministic exit codes and structured health model; it must not daemonize or assume a
specific init system.

## Optional cron heartbeat

`mso heartbeat` is a one-shot health/recovery command, disabled by default. It uses structured gateway
health (including the public MSO identity), rather than treating a live connector PID as healthy.
It starts no monitoring daemon and installs no packages. Existing gateway lifecycle commands retain
update serialization, loopback binding, credential validation and exact process ownership checks.

For a built loopback fallback, set this in the installation's owner-only `.env.local`:

```dotenv
OS_HEARTBEAT_ENABLED=1
OS_HEARTBEAT_INTERVAL_MINUTES=30
OS_HEARTBEAT_FAILURE_THRESHOLD=1
```

Run `mso heartbeat install-cron` once to install a check every 30 minutes and at cron startup. The host
must run cron; in a container the platform must start it after a restart. An `@reboot` entry does not
keep a suspended workspace alive. The installer preserves unrelated cron jobs and captures the current
Node executable directory in the job's PATH. Repeat installation after changing the interval or Node path.
Set `OS_HEARTBEAT_ENABLED=0` to disable checks without removing the job, or run
`mso heartbeat remove-cron` to remove only this checkout's entries. Existing systemd/s6/container/external
supervisors remain responsible for their own services; heartbeat reports their unhealthy state without
adopting or stopping them.

For an **already MSO-managed named gateway**, also set `OS_HEARTBEAT_GATEWAY_CONFIG` to its dedicated
owner-owned config file and `OS_HEARTBEAT_GATEWAY_TUNNEL` to its name/UUID. The recipe must pass the
existing named-gateway preflight before anything is stopped. `OS_PUBLIC_ORIGIN` must match the config.
Heartbeat never replaces a named tunnel with a temporary quick tunnel or adopts an external connector.
A stopped external public route requires its own supervisor; setting these values is not an adoption flow.

Each invocation holds a checkout/origin/env-scoped lock and persists only a timestamp, result and
consecutive failure count under `~/.mso/private/heartbeat/`. Exit 0 means healthy/recovered, disabled or
already being checked; exit 2 means unhealthy/report-only; exit 1 indicates a validation/lifecycle error.
The default threshold of 1 repairs on the first scheduled failure. Higher thresholds count failed
scheduled checks, not seconds. `mso heartbeat once` runs the same check manually without scheduling it.

## Operational examples

Cloudflare remains the current managed/default provider:

```bash
mso gateway start
mso gateway status
mso gateway status --json
mso gateway doctor
mso gateway stop
```

For a named Cloudflare endpoint:

```bash
mso gateway domain set https://mso.example.com
mso gateway start --config ~/.cloudflared/config.yml --tunnel <name-or-uuid>
```

For Tailscale, nginx/Caddy/Traefik, Kubernetes Ingress/Gateway, PaaS routing or another external provider,
keep MSO on its private/loopback binding where topology permits, set the stable `OS_PUBLIC_ORIGIN`, and let
the external supervisor/provider own its process lifecycle. `mso gateway status --json` will report the
route as external only after the public identity matches the selected local MSO runtime.
