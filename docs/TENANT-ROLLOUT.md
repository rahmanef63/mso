# Tenant rollout gates

Status: implementation plan, not a production-readiness declaration. The shared
front gateway may route distinct users, but sharing a folder name or application
profile does not create an OS security boundary. Installed binaries can be shared;
untrusted users need verified worker, storage, credential and session separation.

## 1. Identity and durable memory foundation

The isolated source candidate implements versioned server-owned identity bindings,
revocation generations, guarded durable storage and scoped memory
read/search/remember/forget. Writes commit a sanitized audit event atomically.
Actual MCP route tests use fake verified identities and temporary durable state.
Default behavior remains legacy; no production tenant has been enrolled.

Acceptance: adversarial identity, argument, storage, concurrency and corruption tests;
legacy regressions; independent review; exact-commit isolated build and release E2E.
See [Tenant preview](TENANT-PREVIEW.md) and [Tenant persistence](TENANT-PERSISTENCE.md).

## 2. Enrollment, administration and credentials

Implement a reviewed administrative flow for named identities, exact tenant/principal
bindings, approvals, revocation and recovery. A tenant cannot self-select a directory,
provider, tenant ID or principal ID. Bind credentials to the approved current generation;
never grandfather an unbound credential into tenant authority.

Acceptance: wrong issuer/subject, duplicate mapping, stale generation, revoked identity,
concurrent grant/revoke, refresh replay and root replacement all fail closed. Recovery
preserves generation continuity or explicitly revokes old credentials. No credential
value belongs in source, command arguments, audit events or documentation.

Operational gate: approval for actual named enrollment, persistent grants and credential
configuration. Source tests alone do not authorize those actions.

## 3. Isolated workers and remaining stores

Build a server-owned broker mapping an authenticated context to an exact worker identity.
Enforce ownership of filesystem operations, exec/PTY, jobs, processes, sockets, browser
profiles, sessions, projects, artifacts and backups. A worker must not receive the host
Docker socket, owner credentials, unrelated host mounts or a permissive shared HOME.

Acceptance: traversal/symlink/hardlink tests; peer file/process/socket denial; cross-user
job cancellation and output denial; browser cookie/profile separation; restart ownership;
bounded CPU/memory/PID/disk quotas; scoped logs and backup/restore. A mock broker cannot
prove OS containment. The earlier disposable shell-worker pilot is evidence for those
tested primitives only, not verification of managed application adapters.

Operational gate: exact worker images, identities, mounts, network rules and resource
limits must be approved before provisioning or changing live isolation settings.

## 4. Shared application routing

- Hermes: verify the installed version's profile/HOME/config routing and every tool's
  backend authority. Multiple named profiles alone do not constrain same-UID host access
- OpenClaw: route mutually untrusted users to separate verified trust domains; one
  front gateway does not require one shared privileged application process
- 9Router: decide explicitly whether provider accounts form an intentionally shared
  pool. Private provider ownership requires tenant grants on every selection and retry,
  with no cross-tenant fallback, or separated application runtimes

Acceptance: each adapter has an explicit capability/trust matrix; unsupported operations
remain denied. Tests cover credentials, retry/fallback, session state, browser state,
logs and restart routing without exposing real provider secrets.

Operational gate: approve real application/credential routing and the intended provider
sharing model. Reusing installed software is distinct from sharing private credentials.

## 5. User MCP endpoint and UI

Provide tenant-aware connection setup and user-facing state while preserving an owner
administrative recovery path. All accepted ingress must resolve the same authenticated
principal policy. Browser device roles, owner API routes, A2A and managed-app dashboards
are not automatically tenant endpoints.

The current global tenant-preview mode refuses unbound legacy MCP tokens, including
owner connectors. Do not switch a live installation into that mode before the endpoint,
token audience and administrative cutover/recovery design is verified.

Acceptance: each user sees only allowed tools and their own state; direct tool calls
still enforce authorization when bypassing discovery/UI; cross-endpoint token replay and
caller-supplied tenant selectors fail; owner recovery survives a tenant outage.

## 6. Approved operational pilot

Prepare a concrete two-synthetic-user run using the actual chosen worker and application
adapters. Name exact image identities, limits, mounts, private/loopback networking,
secret-entry method, cleanup scope and recovery steps. Never reuse a completed pilot's
approval as blanket authority to provision another environment.

Acceptance: adversarial separation plus ordinary end-to-end user work, restart and
revocation, quotas, audit redaction and rollback. Retain sanitized evidence; delete only
the exact approved temporary resources and synthetic data after verification.

## 7. Canonical integration and release

Reconcile the preserved candidate with current canonical changes through the supported
workflow. Do not overwrite concurrent WIP or force/reset branches. Run complete release
and security gates, dependency evidence, recovery and capacity tests on the exact
integrated revision. A feature branch is not a shipped release.

Operational gate: explicit deployment/cutover scope, approved real identities and app
routing, a recovery path and a verified rollback. After deployment, prove the intended
revision is served and repeat real endpoint acceptance. Do not claim the overall
multiuser goal complete while any required worker/app/credential boundary is unverified.
