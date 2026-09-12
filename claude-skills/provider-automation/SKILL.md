---
name: provider-automation
description: "Discover, define and run repeatable project API/MCP flows with explicit session, project and connection context, durable receipts and independent verification."
metadata:
  mso:
    risk: high
    policy: inspect-execute-verify
---

# /provider-automation — Provider Automation

## Trigger and boundaries

Use for repeated provider API operations, project MCP chains, and declared project functions. Required: exact project id/path, requested outcome, authorized connection alias, input and idempotency key. Credentials stay in the private connection store. One operation can use its existing tool directly.

## Fast route

1. Call `agent_session_open` once with a stable conversation key, unless this conversation already has a session. Carry returned `mso/sessionId` in request metadata.
2. Call `flow_catalog` with the exact project. Inspect the selected flow to get its input schema, ordered steps and scope.
3. Reuse an existing flow. For a new repeated pattern, inspect the provider operation or paged `project_mcp_tools` schema first; save a versioned definition with `flow_manage` and the catalog revision.
4. Call `flow_run` with project, flow, nonsecret input and a unique logical operation key.
5. Use `flow_status` with `wait_ms:25000` until terminal. Reusing the same key retrieves that run; it never starts its mutations again.

## Tool routing

| Need | Capability |
|---|---|
| Provider operation schema and connection state | integration_query |
| Cloudflare/Hostinger DNS ensure | flow_catalog → flow_run → flow_status |
| Add a project MCP | project_mcp_manage inspect → upsert with revision |
| Discover all downstream tools | project_mcp_tools, following nextCursor |
| Versioned project flow CRUD | flow_catalog / flow_manage |
| Promote a generated asset | session_artifacts → project_asset_attach |
| Display integration controls | mso_ui with the integrations view |

## Execution flow

For multi-step agent work, reuse its exact `workflow_id`; `workflow_start` already resolves skills and learned recipes. The flow runner inherits that workflow and session. Do not start duplicate workflows or bypass scope/allowlists.

Definitions live in `.mso/flows.json` version 1. Steps may use `integration_execute`, `project_mcp_call`, or `project_function_call`. Values may reference `input.name`, `steps.previous.result.field`, or `project` using a whole-value `{"$ref":"..."}`. Project steps inherit the canonical project. Cross-project switching, inline credentials, arbitrary shell templates and forward references are rejected. See `docs/AUTOMATION-FLOWS.md`.

## Verification contract

- Expected state: the requested provider/project state, not merely a completed receipt.
- Targeted checks: inspect the schema and connection before mutation; use a step expectation for required provider checks.
- Runtime proof: inspect each step result and independently query the resulting state.
- Visual proof: verify the integration canvas or project preview for visual changes.
- Diff boundary: only the selected project manifest, connection and authorized provider resources.

## Failure and rollback

A failed or interrupted run stops subsequent steps. An interrupted mutation has an uncertain outcome: inspect the provider before choosing a new key. Never automatically replay, resume or roll back external writes. Existing user authorization remains valid; ask only for genuinely missing scope or input. Receipts are retained for 30 days, so keep important provider identifiers in project documentation.

## Recipe memory

Save reusable metadata and references only. Never store secrets, auth links or copied request bodies containing private credentials. Finish the existing workflow with verified results; failed runs must not replace successful recipes.
