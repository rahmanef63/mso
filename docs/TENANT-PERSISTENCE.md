# Durable tenant persistence candidate

Status: source-only, default disabled. Runtime composition now requires explicit
server-owned configuration. No live identity grants, root, credentials, migration or
deployment are created.

## Implementation and entry points

`openTenantPersistence({ root })` supplies a durable registry, scoped memory port,
trusted administration methods and a tenant audit interface. The caller must supply
an existing canonical absolute Linux directory owned by the service UID with mode0700.
There is no HOME, environment, owner-store or default-directory fallback.

The source factory is internal control-plane code, not an authentication boundary.
Its administration methods are not exposed through a route, MCP tool or CLI.
Calling them in production requires separately reviewed administrative authorization.
The optional initialize:true creates only an empty snapshot, with no memberships,
and only when no state file exists. Ordinary operations never recreate missing state.

The actual capability kernel can read this adapter through an opaque authenticated
context. Tests exercise that path with two real temporary storage namespaces.
`writeTenantMemory` remains an internal raw-document CAS seam. The public tenant MCP
path supports read/search/remember/forget through typed scoped claims, without owner
storage or telemetry. Runtime composition opens existing state only; it never initializes it.

## Transaction model

A single bounded JSON snapshot holds registry bindings, memory records and successful
mutation audit events. Every read and mutation takes the same cross-process exclusive
lock, reloads and validates the snapshot, then releases its own lock. A lock is never
stolen based on age or PID. A crashed lock fails closed and needs reviewed operator recovery.

Trusted administrative and raw-document mutations require the exact expected store
revision. Raw memory also requires the current document version, where0 denotes absence.
Public typed operations read and update the current ledger inside the same lock; they
return a scoped snapshot without exposing the global store revision. Registry changes allocate a new monotonically
increasing mapping generation. Every change, including disable/re-enable, invalidates
old contexts. Tenant-enabled changes update all bindings for that tenant in the same
transaction and record a tenant-scoped event.

The memory writer revalidates subject, binding generation, enabled flags and credential
expiry inside the transaction. Authorization is evaluated at transaction admission;
this is not a guarantee that physical disk commit finishes before wall-clock token expiry.
The shared lock orders revocation against memory commits. A revocation committed first
prevents the queued write; a write committed first remains part of history.

Data and its required audit event are serialized together to a private unique temporary
file, fsynced, renamed atomically, then the directory is fsynced. A pre-rename failure
leaves the previous snapshot. A post-rename durability or lock-cleanup failure returns
TenantCommitUncertain with an operation ID. Never blindly retry that outcome.
Trusted administration.operationStatus(id) reconciles it against the surviving snapshot.
A missing event after restart means the operation is absent from surviving state,
not proof that every possible external effect never happened. This adapter has no external effects.

## Capacity, records and audit

Bounds:16 MiB snapshot,1000 bindings,4000 memory records,10,000 audit events and
64 KiB cumulative content per memory document, including retained typed history.
Typed memory additionally allows at most256 claims and512 KiB encoded ledger. All integers, booleans, record keys, UTF-8 and schema fields
are validated. Unknown fields and duplicate records and malformed state fail closed.

Tenant reads/authentication close at audit exhaustion or within128 KiB of the byte cap.
The byte reserve allows bounded registry revocation updates; capacity cannot silently
leave an active tenant readable while its revocation is unable to fit. No automatic
pruning or history deletion is provided. Capacity/recovery must be designed before scale-up.

Memory is keyed by tenant, principal, mapping generation, collection and fixed document
name. A generation change leaves old bytes retained but inaccessible through the new
binding. There is no automatic migration across generations. Only USER.md and MEMORY.md
are public documents; the fixed internal CLAIMS.v1 record stores validated typed history.
Unknown fields, duplicate IDs, invalid references or mixed nonempty raw/typed state
are refused. Raw documents are never automatically migrated. The reserved collection
types do not implement sessions/jobs/projects.

Audit currently covers successful binding and memory mutations. It is not read,
denial, tool-execution or owner telemetry. Events contain bounded server-generated IDs,
timestamps, fixed tool/document identifiers and scope metadata, never credentials,
subjects, caller memory keys or memory contents. Tenant-wide events
returned through the scoped audit port omit the other principal's identifier.
Trusted administrative reconciliation retains the complete event.

## Filesystem trust boundary

The adapter pins the root's inode/device and opens it with NOFOLLOW. Transaction paths
are anchored through that open directory descriptor using Linux /proc/self/fd.
State leaves must be regular service-owned0600 single-link files and are opened with
NOFOLLOW and NONBLOCK. Symlink roots/leaves, hardlinks, root replacement, unexpected
permissions, oversized state and invalid UTF-8 are refused. The root inode/device is
checked again after acquiring a queued lock before admitting the transaction.

An optional server-owned guard checks the selected mode/root before opening, after
reading locked state, before mutation and immediately before rename. This prevents
queued work admitted after configuration changes. Once rename is in flight, admission
semantics apply: disabling configuration is not cancellation of every in-flight commit.
The open directory descriptor prevents path replacement from redirecting an admitted
operation. Operational replacement still requires draining/revoking the old runtime.

This is application-state separation under a trusted service account. It does not
sandbox malicious code running as the same Unix UID or root, protect a compromised host,
or implement tenant process/browser/network isolation. The existing disposable worker
pilot provides separate evidence; it is not silently provisioned or wired here.

## Reproduce

```sh
umask 077
mkdir -p .tenant-test-home
HOME="$PWD/.tenant-test-home" XDG_STATE_HOME="$PWD/.tenant-test-home/.state" \
  VITEST_MAX_WORKERS=2 bun run test lib/tenancy lib/mcp/tenant-capability-integration.test.ts
node_modules/.bin/tsc --noEmit --incremental false
node_modules/.bin/eslint lib/tenancy --max-warnings=0
```

Tests use synthetic temporary data and delete only their own temporary directories.
Coverage includes disk reopen, independent-process CAS, barrier-controlled queued-write
revocation, disable/re-enable, equal document keys, corrupt snapshots, symlinks/hardlinks,
capacity exhaustion, abandoned locks and injected pre/post-rename failures.
The exact-commit build must use scripts/verify-build.sh, never a live in-place build.

## Remaining integration decisions

Engineering still needed: authenticated enrollment and approved registry administration,
real credential issuance integration, scoped sessions/jobs/projects/artifacts/backups,
read/denial audit, safe recovery/retention and worker adapters. Versioned credential
preservation and the public typed memory operations now have source implementations.
Every unsupported tenant capability remains denied.

Operational approval is needed before creating a real tenant root or binding records,
issuing or configuring credentials, enabling the runtime, assigning workers, changing
network/security settings, migrating data or deploying. Sharing installed binaries is
compatible with isolated workers; sharing a service UID or application credential pool
does not provide that isolation. 9Router private provider routing still needs explicit
per-tenant grants and no cross-account fallback, or an explicitly approved shared pool.
