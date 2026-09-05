---
name: integrations
description: Manage MSO credential users, providers, named connections, source backends, auth methods, verification, and private setup without exposing provider secrets to chat.
metadata:
  mso:
    risk: high
    policy: credential-isolation
---

# /integrations — native credential connection management

Use this skill when the owner asks to inspect, add, select, verify, route, transfer, or repair a service integration in MSO. The canonical model is:

```text
Credential user → Provider → Named connection → Source/backend → Auth method/scope
```

MSO owns this model. Do not read another application's private credential store as a shortcut and do not create a parallel provider/key registry.

## Trigger and boundaries

Use this skill for GitHub, Vercel, Convex, Hostinger, Dokploy, Cloudflare, Composio, Resend, Stripe, Clerk, Supabase, self-hosted Convex, and future providers registered in the native Integrations catalog.

Never ask the user to paste a token, API key, password, OAuth code, private setup URL, cookie, or generated secret into chat, tool JSON, shell argv, logs, memory, or documentation. Credential values enter only through the dedicated private setup/browser flow.

`/integrations` with no arguments opens the native Finder-style human UI. `/provider` and `/providers` are compatibility aliases only and are not the canonical product surface.

## Fast route

1. Read the current native catalog/users/connections with `integration_query`.
2. Resolve the exact credential user/provider/connection before any provider operation.
3. If a direct connection needs a new or rotated secret, call `integration_setup_open`; the human completes the private form.
4. Verify or route the exact connection with `integration_execute`.
5. Use `integration_manage` only for explicit metadata changes and confirmation-gated mutations.
6. Re-read the connection after mutation and report its non-secret state.

## Tool routing

- `integration_query`: catalog, users, named connections, source/auth instructions, folder/default resolution.
- `integration_manage`: user/connection/folder metadata CRUD, credential deletion, hosted authorization metadata. Respect its confirmation boundary.
- `integration_execute`: verify, route, and supported bounded provider operations using the selected identity.
- `integration_setup_open`: open the private credential-entry flow for an existing direct connection. Never request or reproduce its private capability in conversation text.
- Provider-specific bounded tools may be used after the exact connection is resolved. Do not silently fall back from Composio/provider-MCP to a local direct key.

## Execution flow

### Inspect or diagnose

Resolve the requested identity. If the user names a connection, use that exact connection. Otherwise apply MSO's resolver: explicit selection, folder binding, provider default, then sole unambiguous connection. An ambiguous result is a decision point, not permission to guess.

Compare these independently:

- connection metadata exists;
- required fields are configured;
- source/backend is correct;
- auth method/scope is correct;
- live provider verification succeeds;
- the requested operation is supported for that source.

Do not claim an OAuth/provider-MCP account is connected merely because routing metadata exists.

### Create a connection

Use the provider catalog to choose a valid source and auth method. Create a stable named connection, then open private setup only when the source is direct and secret fields are required. For Composio or provider-owned MCP, follow the hosted/provider authorization route instead of collecting OAuth secrets locally.

Multiple deployment/account connections under one provider are first-class. Never overwrite `production` with `staging` merely because they use the same auth method.

### Transfer identities

Use Integration Bundle v1 for deliberate portability. Plain JSON is metadata-only. Encrypted bundles may carry direct credentials through the dedicated private import/export path. OAuth sessions and externally managed connected-account secrets are not portable and require reauthorization.

## Verification contract

A successful change requires evidence from the exact selected identity:

- re-read user/provider/connection metadata;
- verify the provider where a live verifier exists;
- for routing/execution, confirm the resolved user, connection, source, auth scope, and operation result;
- never expose raw provider response fields that are secret-shaped.

Browser form success, a rendered Page, or existence of a token field is not by itself proof that the upstream account is authorized.

## Failure and rollback

Preserve the first concrete failure. Do not delete/recreate users, connections, OAuth links, DNS records, deployments, or credentials as a first repair step.

If a mutation fails or its outcome is uncertain, re-read state before retrying. Never repeat a credential rotation automatically. If a stale setup form or connection revision is rejected, open a fresh setup flow rather than bypassing revision checks.

## Recipe memory

Reusable memory may store the provider/source/auth topology, non-secret connection labels, supported operation paths, and verified repair sequence. Never store credential values, setup capabilities, private authorization URLs, cookies, generated webhook secrets, or OAuth tokens.
