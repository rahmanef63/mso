# Private connections for modular project MCPs

MSO's generic project MCP tools can use a named private Project MCP integration.
This keeps one user-facing connector while each downstream app remains modular.
The host capability keeps exec-scope enforcement, rate limits and audit ownership.

## Default and installation boundary

A fresh project has no project MCP server and no SI-Coder/Batonly plugin. MSO's plugin catalog is only a list of available integrations. Project installation targets one exact project and writes only that project's `.mcp.json`; parent and sibling manifests are not inherited. The explicit `project="@host"` target separately manages this VPS's host MCPs; host bindings are never copied into projects.

Reviewed plugins use compact identities rather than copied executable/endpoint details:

```json
{
  "mcpServers": {
    "si-coder": { "plugin": "si-coder", "credentialAuthority": "mso" },
    "batonly": {
      "plugin": "batonly",
      "credentialAuthority": "mso",
      "integration": { "user": "owner", "connection": "batonly-assistant" }
    }
  }
}
```

SI-Coder resolves the reviewed installed package at call time. Batonly resolves its reviewed HTTPS endpoint from MSO's plugin catalog and requires the referenced private MCP connection to target that endpoint. The project file stores neither Batonly's endpoint nor its bearer.

Arbitrary HTTP MCPs remain modular too. An HTTP server in the selected project's regular `.mcp.json` may include:

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

HTTP probes modern `server/discover` once. JSON-RPC `-32601` (method not found),
modern-protocol refusal (`-32022`), and HTTP 400/404/405 without a malformed-request
error fall back to legacy `initialize` + `tools/list`. A JSON-RPC error on HTTP 200
is treated as unsupported, not a hard failure. Modern stdio is opt-in with
protocolVersion: 2026-07-28. Rich image/audio/resource results
are preserved; downstream UI metadata is namespaced rather than trusted as MSO UI origins.

Use **Store → MCP** or **Settings → MCP → MSO to External → MCP** for reviewed SI-Coder/Batonly installation, or `project_mcp_manage` with revision checks. Use Integrations → Add MCP for reusable private MCP credentials. Arbitrary HTTPS project MCPs can still be registered directly with `url`. See [automation flows](AUTOMATION-FLOWS.md) for CLI, sessions and assets.
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


## Store, host scope, and dynamic harness

Store has **Apps**, **MCP**, and **Skills** tabs. The MCP and Skills panels are shared
with Settings → MCP → MSO to External; their install state is read from the VPS,
not a second browser-local installation registry. Previous browser-only custom
manifests remain available for explicit review; they are never auto-executed.

For host MCPs, choose **This MSO host** in the UI or `project: "@host"` in the existing
generic tools. The binding directory is `.mso-host-mcp` beneath the first configured
owner write root. It obeys read/write bounds and rejects symlink directories.
No private MSO credential directory is exposed through ordinary filesystem tools.

1. `project_mcp_manage({project:"@host", action:"inspect"})` returns aliases and revision.
2. Install/remove with the same tool and the fresh revision. Inspections have a separate bounded read budget; refresh does not consume the mutation quota. Reviewed SI-Coder uses
   its existing managed runtime; Batonly uses an explicitly selected private connection.
   Custom HTTPS MCP endpoints can be added without copying credentials into the manifest.
3. `project_mcp_tools({project:"@host",server:"alias",refresh:true})` discovers live schemas.
   Follow `nextCursor`; neither a successful page nor an installation proves every action.
4. `project_mcp_call({project:"@host",server:"alias",tool:"exact_name",arguments:{...}})`
   dispatches through the existing guarded transport and private authorization policy.

This is **ChatGPT → MSO → installed MCP**, without adding every downstream tool name to
MSO's global catalog. Installation changes take effect at lookup time; after uninstall,
new calls fail. Refreshing the MSO client exposes changed descriptor text, but no
per-plugin ChatGPT connection is necessary. Each downstream service still requires
its own authorization; MSO is not a permission bypass.

Remote MCP install/uninstall adds/removes a local connection manifest, not the remote
SaaS application. A managed SI-Coder binding does not own its shared runtime. Consequently
uninstall preserves shared binaries, Integrations credentials and provider data. Arbitrary
npm/OCI/archive runtime downloads are not performed by this Store panel.

## Skills on the VPS

Store → Skills and the matching Settings tab use the existing reviewed `skill-market`
catalog and repository-owned CLI. Install copies checksum-verified `SKILL.md` and its
management receipt into `MSO_SKILL_INSTALL_ROOT` (default `~/.mso/skills`). The skill
scanner uses the same root. Uninstall removes only unchanged, marker-owned contents;
modified, unmanaged, extra files and symlink targets are refused for manual review.
An unchanged older managed version can be updated through the same flow.

The browser API is Owner-only, bounded, audited and revision-checked. Local CLI commands
remain available offline. `mso skills store list` reads the server snapshot;
`mso skills store install <id> <revision>` and `mso skills store remove <id> <revision>`
use the same guarded API as the UI. Existing project, official and manual skills remain
visible but are not deleted by the Store. Installing instructions never grants tool access.
