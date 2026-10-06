# Tenant preview: identity and scoped memory

Status: isolated implementation candidate, disabled by default. This is not a
production multiuser release. No live tenant registry/storage activation, provisioning,
credential issuance, account migration or app runtime wiring is supplied.

## Purpose and mode

OS_TENANCY_MODE is absent or legacy by default. Existing owner behavior is unchanged.
The tenant-preview value selects a fail-closed experimental MCP/capability path.
Unknown values fail closed. Do not enable this setting on a production/shared-user
deployment without the separate operational approval and release checks below.
OS_TENANCY_STORAGE_ROOT must explicitly select an existing, initialized private store.
The runtime never creates a root, initializes state or enrolls an identity.

A server token carrying a tenant binding or deprecated tenantSubject marker cannot fall back to owner authority when
preview is disabled. An opaque tenant context also stops working after mode disablement.

The flag does not turn browser device roles, owner /api/v1 routes, A2A ingress,
managed-app dashboards or the host account into tenant endpoints. Those surfaces
need their own reviewed identity and isolation work before multiuser deployment.

## Actual integration points

- app/mcp/route.ts validates the existing bearer, resource binding and protocol,
  then resolves a server-owned named subject before any legacy session/client-state work
- lib/mcp/tenant-dispatch.ts provides a separate metadata/tool path without the
  owner activity/audit, session, workflow or standby dispatcher
- lib/capabilities/execute.ts checks tenant mode/context before legacy presence,
  workflow lookup, title changes, activity, session events or tool execution
- lib/tenancy/authority.ts issues opaque process-local contexts from a trusted registry
- lib/tenancy/storage.ts derives and verifies scoped storage addresses
- lib/tenancy/runtime.ts lazily composes the durable adapter from server-owned configuration
- lib/tenancy/public-memory.ts derives read/search/write grants from the opaque context
- Capability invocation context propagation must preserve the opaque tenant context;
  loss of context in preview fails closed rather than restoring host authority

## Identity contract

The versioned binding comes from the already validated, server-owned MCP token record.
It is not taken from request JSON, MCP metadata, session headers, clientId, labels,
integration profiles or filesystem folders.

Owner consent and PAT issuance do not assign tenantBinding. Existing tokens remain
legacy credentials when preview is off and are refused in preview because they have
no approved versioned binding. This candidate creates no live grants or persistent access.

A trusted registry resolves issuer+subject to one enabled binding:
tenantId, principalId and mappingRevision. The tenant must also be enabled.
An ambiguous lookup must fail; it must never choose a default tenant.

The binding is cloned and frozen in an opaque WeakMap-backed context. Callers cannot
forge it by copying fields. Every access revalidates expiry, revocation, principal,
tenant and revision. A principal reassignment requires a newly approved credential, not merely a new context.

Registry implementations must provide authoritative, consistent results, and increment
mappingRevision whenever a binding changes. This library validates the revision;
it cannot enforce an external registry writer.

## Credential lifecycle and runtime composition

TenantCredentialBinding version1 pins issuer, subject, tenantId, principalId and
mappingRevision. Issuers are bounded internal registry IDs, not arbitrary OIDC URLs.
Every tenant request compares that exact immutable stamp with the current authoritative
registry before context creation. Disable/re-enable and remapping never upgrade an old
credential to the new binding. Missing, malformed, unknown-version and deprecated
subject-only stamps are denied, including attempts to downgrade into legacy owner mode.

The injected runtime factory accepts registry, storage, verifier, mode and clock ports.
Its bearer entry point calls the verifier; resolveValidatedToken is reserved for
transports that already verified the bearer. The default runtime opens no store while
preview is disabled. In preview, it requires a valid versioned token stamp and explicit
OS_TENANCY_STORAGE_ROOT, then opens that store with initialize:false. It never infers
identities or enrolls anyone. Changing the configured root after composition fails
closed and requires a reviewed restart; a failed open is not silently retried elsewhere.

McpCode, access and refresh records preserve the same stamp. Code exchange and refresh
inspect the full persisted record before deletion or field projection. Issuance also
reauthorizes before storing replacements. Rotation and grant-family revocation retain
the existing OAuth-store lock, and revocation remains possible for stale bindings.
Inputs are captured before queued mutations; request body fields never select identity.

The OAuth store and registry are separate transactions. A registry change racing an
issuance can leave an unusable old-generation record; every later request denies it.
This is not cross-store atomic issuance or cancellation of every in-flight request.
The source APIs do not grant enrollment authority, and no live verifier/root is configured.

## Storage contract

A read address contains tenantId, principalId, mappingRevision, collection and key.
Every field is derived from the authenticated context or a bounded server operation.
There is no directory argument and no owner/global fallback.

The storage port must query using the complete address. Returned envelopes must echo
the exact address or the read is refused. Binding state is checked again after the
await, so an expired/revoked/remapped identity does not receive the result.

The public MCP path implements scoped memory read, search, remember and forget.
Collection types reserve memory, sessions, jobs, projects, artifacts and backups;
these types are not permission to expose those other collections.

A source-only durable registry/memory/audit adapter now exists; see [Tenant persistence](TENANT-PERSISTENCE.md).
The source runtime composition requires an explicit private root. No live root or
mode has been configured by this work. OS isolation and production administrative
authorization remain separate requirements.

## Capability contract

Tenant preview implements the existing agent_memory_read, agent_memory_search,
agent_memory_remember and agent_memory_forget contracts. USER.md and MEMORY.md are
scoped by tenant, principal and mapping generation. Missing records yield empty
memory, never owner memory. Typed claims preserve kind, confidence, sensitivity,
validity, supersession, conflict and retraction semantics without invoking owner storage.

The internal CLAIMS.v1 ledger is never a caller-selectable document. It holds at most
256 records and512 KiB encoded state, with64 KiB cumulative content per document,
including history. Capacity fails closed; forget retracts rather than purges history.
Existing raw documents are readable but are not silently converted into typed history;
nonempty raw state requires an explicit reviewed migration before typed operations.

The kernel still enforces token tool allowlists, argument constraints, scopes and
declared rate limits. Rate keys use the verified tenant principal. Every memory tool
rejects caller-provided tenant/user/path/workflow selectors and unexpected arguments.
Writes revalidate current binding, expiry and configuration inside the shared durable
transaction and commit their success audit atomically. Reads are revalidated after awaits.

Exec, filesystem, browser, managed apps, integrations, project MCP, sessions,
workflows and every unknown capability are denied before the legacy handler.

Tenant metadata exposes only the four implemented tools. Resources are empty; resource
reads are denied. It retains Origin, SSE and modern-protocol HTTP rules.
No owner telemetry is written in preview; the durable candidate records internal successful mutations only.
The memory mutation audit contains fixed tool/document identifiers and derived scope,
never memory keys, values, subjects or tokens. Read/denial auditing still needs integration.
GET metadata reports whether a root string is configured, not store health or readiness.

## Verification

The candidate has fixture-based authority/storage, kernel/dispatcher and HTTP-boundary
coverage plus legacy MCP route, authorization, protocol and environment regressions.
Fixtures use synthetic subjects/storage. Basic HTTP-boundary tests mock handoff;
the persistent-route suite instead exercises actual POST, runtime composition,
dispatch, kernel and temporary durable storage while faking only bearer verification.
This is integration coverage, not an operational tenant authentication deployment.

Reproduce the focused suite after installing the repository's existing dependencies:

```sh
umask 077
mkdir -p .tenant-test-home
HOME="$PWD/.tenant-test-home" XDG_STATE_HOME="$PWD/.tenant-test-home/.state" \
  OS_FS_READ_ROOTS="$PWD:$PWD/.tenant-test-home" VITEST_MAX_WORKERS=2 \
  bun run test lib/tenancy \
  lib/mcp/tenant-capability-integration.test.ts app/mcp/tenant-route.test.ts \
  app/mcp/tenant-persistent-route.test.ts \
  app/mcp/route.test.ts app/mcp/route-protocol.test.ts \
  lib/mcp/dispatch-authorization.test.ts lib/config/env-example.test.ts --maxWorkers=2
```

The ignored fake HOME keeps incidental test state separate from the operator's real
home. Do not stage it. A fixture pass does not replace typecheck, compilation, full
regression, tenant backend verification, integration review or deployment approval.

## Remaining release gates

1. Verify the exact candidate and current integration base with typecheck, supported isolated build and release tests
2. Review and authorize durable registry/memory activation; implement the remaining scoped stores
3. Authorize named enrollment and real credential issuance using the implemented binding lifecycle
4. Wire guarded file/exec/job/browser workers and tenant-aware audit without owner fallback
5. Verify each actual Hermes/OpenClaw/9Router adapter and its provider retry semantics
6. Cover other ingress surfaces, real-user E2E, recovery, quotas and security review
7. Integrate on the current canonical base and verify before separately approved deployment

No new public MCP tool names or schemas are introduced. The full legacy catalog stays
unchanged; tenant preview advertises only its four implemented memory tools.
