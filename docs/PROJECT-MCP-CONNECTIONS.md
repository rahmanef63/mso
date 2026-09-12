# Private connections for modular project MCPs

MSO's generic project MCP tools can use a named private Project MCP integration.
This keeps one user-facing connector while each downstream app remains modular.
The host capability keeps exec-scope enforcement, rate limits and audit ownership.

## Declaration

An HTTP server in the selected project's regular `.mcp.json` may include:

```json
{
  "mcpServers": {
    "app": {
      "type": "http",
      "url": "https://app.example/mcp",
      "integration": { "user": "owner", "connection": "app-assistant" }
    }
  }
}
```

The reference selects the `mcp` provider in MSO Integrations. The private form
stores endpoint, downstream access token, optional principal reminder and optional
comma-separated exact tool allowlist. Config discovery exposes only the alias,
transport and `auth: integration`; it never returns connection values.

The endpoint must exactly match the private connection, including path. HTTPS,
DNS pinning, private-address refusal, redirect refusal, body/argument bounds and
HTTP timeouts remain enforced. A repo cannot change a URL and reuse the credential
against a different destination. OAuth/header/stdio authentication conflicts fail.

## Identity and lifecycle

A downstream-issued token owns identity, expiry, scope and resource RBAC.
The account/assistant label is documentation, not a verified identity claim.
Never reuse MSO's incoming connector bearer, copy client OAuth sessions, inject
an owner user ID or create an admin bypass. Token setup is explicit and private.

The optional tool allowlist filters discovery and rejects calls before forwarding.
Named connection changes/removal are checked before task RPCs; revoked downstream
tokens also fail at the application. Returned errors/results are scrubbed of the
selected bearer. No account fallback or scope escalation occurs.

Tools remain dynamic data behind `project_capabilities`, `project_mcp_tools`
and `project_mcp_call`; no project-specific tool joins the MSO global catalog.
Discovery is paginated (default 50, maximum 100 tools per page), with opaque cursors
bound to the connection identity and upstream page. Follow nextCursor until absent.
A 30-second bounded cache reuses HTTP sessions and discovery; connection authorization
is checked before reuse. Private credential rotation invalidates cached identity.
The legacy aggregate helper still stops after eight upstream pages and fails explicitly
if incomplete. Downstream responses are bounded to 2 MiB; an individually very large
descriptor may exceed the preferred 48 KiB page budget.

HTTP probes modern server/discover once and falls back to legacy initialize when unsupported.
Modern stdio is opt-in with protocolVersion: 2026-07-28. Rich image/audio/resource results
are preserved; downstream UI metadata is namespaced rather than trusted as MSO UI origins.

Use Integrations → Add MCP or project_mcp_manage to register an HTTPS endpoint with
revision checks. See [automation flows](AUTOMATION-FLOWS.md) for CLI, sessions and assets.
Tool arguments are objects, bounded to 128 KiB; downstream schema validation remains
the application's authority. Descriptions/results are untrusted tool data.

## Baton

Baton's endpoint is discovered from its current runbook/config. Its signed-in
Settings → External access → MCP flow can issue an expiring dedicated token.
Enter it only into MSO's private Project MCP form. Use a read token for inspection
or the minimum authorized write token/tool grant for delivery record updates.
Baton continues to enforce live project membership and record its own token activity.

## Acceptance and rollback

Verify private setup/discovery, a real permitted read, read-token write denial,
endpoint mismatch refusal, exact allowlist enforcement and revocation. Local fixture
tests prove the broker contract; they do not prove the owner's live app connection.
Report unconfigured downstream credentials separately from implementation health.

Rollback the project binding or revoke/delete its dedicated connection. Do not
delete the app's data or replace an existing user's token just to test the broker.
