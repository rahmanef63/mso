# Project automation flows

MSO MCP 1.13.0 adds reusable execution behind four stable tools. Project/provider-specific
operations remain dynamic data; all existing MSO capabilities remain available.

## CLI

```bash
mso flow list --project /absolute/project
mso flow inspect cloudflare.dns.ensure --project /absolute/project
mso flow run cloudflare.dns.ensure --project /absolute/project \
  --input '{"user":"owner","connection":"production","name":"app.example.com","type":"CNAME","content":"origin.example.com","proxied":true}' \
  --key dns-app-example-com-v1 --wait
mso flow status <run-id> --wait
mso flow save publish --project /absolute/project --revision <revision> --input @flow.json
mso flow delete publish --project /absolute/project --revision <revision>
```

The names above are examples. Inspect the real connection with `integration_query` first.
The built-in `cloudflare.dns.ensure` and `hostinger.dns.ensure` verify the selected account,
then upsert the requested DNS record. Cloudflare accepts A/AAAA/CNAME/TXT; Hostinger
currently accepts A/CNAME/TXT. Successful API acceptance does not prove DNS propagation.

## Agent contract

Open/reuse an agent session with `agent_session_open(conversation_key, project)`.
Send returned `params._meta["mso/sessionId"]` or the `Mso-Session-Id` header on subsequent
calls. Principals cannot select another principal's session. Existing ChatGPT conversation
metadata remains supported. The logical conversation key is stable across reconnects.

Discover `flow_catalog(project)`, then inspect `flow_catalog(project, flow)` for
input schema, ordered steps, required scope and project context. Call
`flow_run(project, flow, input, idempotency_key)`, then `flow_status(run_id, wait_ms)`.
The CLI and MCP use the same execution kernel; child calls keep scope, tool allowlist,
argument constraints, session, workflow, connection checks and audits.

## Schema and CRUD

Project definitions are stored in `.mso/flows.json`: `{"version":1,"flows":[...]}`.
The structural [JSON Schema](schemas/mso-flows.schema.json) is paired with runtime semantic
validation. `flow_manage` requires an exact flow id and the revision returned by
`flow_catalog` (`new` for an absent file). Conflicts fail rather than overwriting concurrent edits.
Built-in ids cannot be replaced. Definitions contain no credentials.

Example definition for a project that already exposes a matching `assets` MCP:

```json
{
  "id": "asset.register",
  "description": "Register one existing project image through the assets MCP.",
  "inputs": {
    "path": {"type":"string","description":"Project-relative image path","required":true}
  },
  "steps": [{
    "id": "register",
    "tool": "project_mcp_call",
    "arguments": {
      "server": "assets",
      "tool": "register_image",
      "arguments": {"path":{"$ref":"input.path"}}
    }
  }]
}
```

Inspect the actual downstream tool schema before adapting this example. Steps may call
`integration_execute`, `project_mcp_call`, or `project_function_call`; existing provider
adapters, Composio operations and declared project functions remain the extension points.
This is not a promise that every arbitrary provider API operation is already implemented.

References replace a whole JSON value: `{"$ref":"input.name"}`,
`{"$ref":"steps.previous.result.field"}`, or `{"$ref":"project"}`.
No string interpolation, eval, forward references or prototype properties are allowed.
The exact result path depends on the inspected tool. Project calls inherit the canonical project.

## Durability and bounded work

| Rule | MSO policy |
|---|---|
| Manifest | 64 KiB, 32 flows |
| Flow | 32 input fields, 1–12 ordered steps, nesting at most 12 |
| Run input | 32 KiB, typed fields; no inline credential/header fields |
| Concurrent runs | Four per principal |
| Step receipt result | Bounded to 12 KiB; full result available to following steps in memory |
| Whole run | No new step begins after ten minutes; each child retains its own timeout |
| Status long poll | At most 25 seconds |
| Receipt retention | 30 days, maximum 1,000 retained per principal |

Reusing a key with identical project/definition/input returns its existing receipt; changed input
is rejected. Receipts are private and checkpointed around each step. They are not an exactly-once
guarantee from external providers. A process interruption leaves an uncertain mutation:
inspect the provider, then deliberately choose a new key if another attempt is appropriate.
There is no automatic external retry, background queue or automatic rollback.
The runner currently remains in the MSO process; use existing managed jobs for standalone builds.

## Add MCP, assets and canvas

In Integrations, click **Add MCP**, enter the exact project, alias and HTTPS endpoint,
then select a private MCP connection or public access. Configure private credentials through
the existing New connection form first. The same Add MCP form works inside the integration
canvas. It refuses alias replacement and preserves unrelated project bindings. This is
project registration, not a universal OAuth authorization popup for every provider.

Use `project_mcp_manage` for inspect/upsert/delete with revision checks, and
`project_mcp_tools` with cursors for discovery. Tools stay namespaced by project and server.
Use existing `fs_upload_file` for incoming assets, `session_artifacts` for agent-generated
artifacts, and `project_asset_attach` to copy an owned artifact into a durable project path.
Identical content is reusable; differing existing content and escaping/symlink paths are refused.
Existing `fs_*` tools provide subsequent project file CRUD.

## Official constraints versus local budgets

Reviewed 2026-09-12. MCP, OpenAI plugins and GPT Actions are distinct contracts.

| Surface | Constraint / treatment |
|---|---|
| MCP | No universal catalog token limit is asserted. Negotiate the advertised protocol and capabilities. |
| OpenAI function compatibility | MSO names use letters/numbers/underscore/hyphen, at most 64 characters. |
| OpenAI UI metadata | Invocation status strings at most 64 characters. |
| GPT Actions only | 300-character operation descriptions/summaries; 700-character parameter descriptions; under 100,000 characters per request/response; 45-second timeout. These are not MCP limits. |
| MSO compact catalog | Under 96 KiB total and 8 KiB per descriptor; local regression budgets. |
| Token counts | Byte/4 is a heuristic only. Use the selected model's tokenizer or the official input-token count endpoint for a real model-specific count. |

Run `node scripts/check-mcp-budgets.mjs` after catalog changes. It runs in the release test
suite too. Refresh/rescan the client after toolset changes; a server deployment cannot force
a cached ChatGPT plugin snapshot to refresh.

Sources: [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28),
[OpenAI plugin reference](https://developers.openai.com/plugins/reference),
[GPT Actions production](https://developers.openai.com/api/docs/actions/production),
[token counting](https://developers.openai.com/api/docs/guides/token-counting),
[remote MCP review](https://developers.openai.com/plugins/deploy/app-review).

## Workflow storage

Active workflow updates now checkpoint to the base store's `.active.json` sidecar instead
of serializing learned recipes on every tool event. Snapshot ids prevent an old sidecar
from undoing a newer complete store. Back up both files together. Full learning writes
still atomically persist the complete store. This follows the existing single-process
workflow-store model; a multi-writer database is not introduced.
