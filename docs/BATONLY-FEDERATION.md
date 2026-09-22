# Batonly capability federation worker

Snapshot: 22 September 2026

MSO can act as Batonly's approved pull worker without giving Batonly an MSO bearer credential. This is the execution bridge for Batonly's Composio-like integration surface while Baton remains the project-management/evidence authority.

## Runtime direction

The worker is opt-in by project configuration, not a host-global requirement.

- It starts only when MSO can resolve the configured Batonly project and that exact project has an MCP server alias named `baton`.
- `MSO_BATONLY_FEDERATION_DISABLED=1` disables it explicitly.
- Generic MSO installations with no Batonly project/MCP remain idle.
- The worker uses the existing project MCP credential boundary. It never accepts a remote endpoint/token from a Batonly execution request.

## Protocol

The Baton MCP side provides:

- `baton_federation_requests_list` with `pendingOnly=true`
- `baton_federation_request_claim`
- `baton_federation_request_complete`
- `baton_federation_request_fail`
- `baton_federation_worker_heartbeat`

Polling is bounded (10 seconds base, exponential backoff up to 60 seconds). Baton owns atomic claim leases and retry attempts. MSO executes at most one claimed request per poll iteration.

## MSO execution

For `source=mso`:

1. Resolve the exact operation from canonical `TOOLS_BY_NAME`.
2. Validate credential-free bounded arguments.
3. Require Batonly's request scope to equal the tool's declared scope.
4. Require explicit confirmation for every write/exec operation.
5. Refuse recursive `project_mcp_call` back into the Baton MCP.
6. Execute through `executeCapabilityCall` with principal `batonly-federation`, preserving required args, rate limits, workflow correlation, activity and audit.
7. Sanitize/bound the result before returning it to Baton.

## SI-Coder execution

The worker resolves the reviewed installed SI-Coder package through MSO's managed installation path. It does not execute command strings supplied by Batonly.

Current live runtime evidence is SI-Coder 0.9.8 with **55 machine functions**, including `sc.flow.list/show/validate/run`. Arguments are validated against the discovered machine function JSON Schema before invocation. `sc.flow.run`, `sc.update`, and `sc.doku.mcp.call` are treated as exec scope; mutating user/provider/memory/recipe/data/mail functions are write scope; remaining functions are read scope.

Provider credentials continue to use SI-Coder/MSO named connections. Federation arguments and results reject/redact credential-shaped keys and secret-like values.

## Operability

- Node instrumentation starts the worker after MSO boot only when the Baton project MCP exists.
- `GET /api/v1/federation/status` is owner-authenticated and no-store, exposing safe worker status only.
- Heartbeats report worker/MSO/SI-Coder versions and capability counts, never credential values.
- The Node executable for portable stdio MCP manifests is resolved to the trusted current `process.execPath`; this avoids scrubbed-service-PATH failures such as `spawn node ENOENT`.

## Acceptance

Do not claim runtime parity until all are true against production Baton:

1. worker heartbeat is fresh;
2. one MSO read completes queue → claim → execute → complete;
3. one SI-Coder read completes the same path;
4. unconfirmed write/exec is rejected;
5. credential-shaped input is rejected;
6. duplicate/invalid claim fails closed;
7. removing/revoking the Baton project MCP connection makes polling fail closed;
8. Batonly reports the completed result and truthful worker availability.
