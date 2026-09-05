# Native Integrations

MSO owns a named-connection model, not one global API-key form per provider.
The browser, CLI and MCP tools call the same native services. No separate credential
application, package or plugin is required.

```text
Credential user                       MSO device role
  └─ Provider                           └─ Viewer / Operator / Owner
      └─ Named connection                   controls permission, not account choice
          ├─ Source / backend
          ├─ Authentication method + scope
          └─ Direct fields OR external routing identifiers
```

A credential user is a context for service accounts, **not a login or an access-control
boundary between MSO operators**. An authorized Owner or suitably scoped MCP client
can manage the profiles exposed to that MSO instance. Selecting a profile must never
silently select another user's key.

## Named accounts and deployments

One user can have `convex-cloud/admin`, `convex-cloud/mimin-production`,
`convex-cloud/mimin-staging`, and other deployments independently. Each connection
has a stable ID, display label, provider, source, authentication method, scope, and
revision. Changing a label is not changing the upstream identity.

Resolution is: explicit user → longest matching folder binding → default user.
Within that user: explicit connection → matching folder's provider binding → provider
default → sole connection. Several connections without an explicit/default selection
are ambiguous and refused. An explicit missing user/connection is never replaced by
a default from somewhere else. Compound direct operations pin resolved values for
their duration; concurrent work cannot mix two profiles partway through one operation.

## Sources are not authentication methods

**MSO direct** stores owner-only local credential fields. **Composio** keeps the
provider's OAuth/API credentials upstream; MSO stores its connected-account ID,
auth-config ID, broker reference, toolkit, and lifecycle status. **Provider MCP**
returns the provider-owned MCP route and authorization instructions, rather than
pretending a local API key is an authenticated OAuth session.

A Composio project credential is itself a direct named connection under the same
credential user. Organization administration keys cannot substitute for that broker.
Hosted authorization validates the toolkit and auth scheme, requires an explicit
config when several match, and only creates a managed config with explicit approval.
The remote user ID uses an installation UUID and immutable profile UUID. External
account execution includes the exact connected-account ID, rechecks its identity,
and holds a short operation lease against concurrent deletion/relink/rotation.

Provider-MCP OAuth is completed in the provider's client. Returning that route does
not prove the external session is authorized, and MSO never falls back to a local key.

## Browser and ChatGPT

Open `/integrations`. Public instructions are readable before sign-in; an Owner
session is required to read/manage credential profiles or open their private forms.
Choose the credential user, provider, named connection, source and authentication.
User creation/rename/duplicate/default/deletion, folder mappings, connection CRUD,
verification and credential clearing use the same metadata actions as the CLI/MCP.
User duplication copies metadata by default. Copying direct credential values needs
the separate explicit `copyCredentials` opt-in; external linked identities are never
copied into a different profile.

The secure form is bound to an **existing direct connection**, not just a provider.
It displays official guidance, masked fields, show/hide, and Validate & save. Blank
fields preserve existing values. Keys go directly to the MSO HTTPS endpoint, never
through MCP tool arguments, chat messages, widget state or browser storage. Success,
expiry and navigation clear inputs. A failed provider check never replaces an old key.

`render_mso_page` with `/integrations` opens this same manager. Page v7 retains
resource aliases for older clients, initializes the standard MCP Apps bridge, and
uses the actual display mode returned by the host. Fullscreen fills the iframe's
available viewport instead of retaining an inline height cap. The host still controls
whether fullscreen is available and how large its viewport is.

A connector that cached old tools must refresh to discover the new actions. A missing
action or private grant is an explicit recoverable error, not evidence of successful
setup. Opening an outer widget is not proof that its form or provider authorization works.

## CLI

Inspect methods before creating a connection:

```sh
mso integrations create-user rahman "Rahman"
mso integrations request rahman convex-cloud
mso integrations create-connection rahman convex-cloud mimin-production direct deployment
mso integrations create-connection rahman convex-cloud mimin-staging direct deployment
mso integrations connections rahman convex-cloud
mso integrations setup rahman convex-cloud mimin-production
mso integrations verify rahman convex-cloud mimin-production
mso integrations resolve rahman convex-cloud mimin-staging
```

`setup` prints a private ten-minute fragment URL **only in an interactive terminal**.
Do not paste it into chat or logs. `mso provider setup <provider> <user> <connection>`
is a compatibility entrypoint to the same flow. Offline CLI help/update does not load
the connection manager until requested.

Metadata changes require confirmation and contain no secrets:

```sh
mso integrations manage '{"action":"folder.map","user":"rahman","path":"/absolute/project","provider":"convex-cloud","connection":"mimin-staging","confirm":true}'
mso integrations which /absolute/project
mso integrations execute '{"user":"rahman","provider":"dokploy","connection":"production","operation":"dokploy.projects.list","confirm":true}'
```

## Machine tools and operation coverage

`integration_query` reads catalog/users/connections, resolves an identity, and returns
source-aware setup instructions. `integration_manage` performs confirmed user,
connection, folder-binding, credential-deletion or hosted-authorization actions.
`integration_execute` takes explicit user/provider/connection and returns a route,
verifies that connection, performs supported bounded direct operations, or executes
a toolkit-matching Composio tool using its exact connected account.
`integration_setup_open` requires `user`, `provider` and `connection`; optional `method`
must match the connection. Its private grant exists only in result `_meta` for the UI.

Existing Dokploy, Cloudflare and Hostinger MCP tools now accept `user`, `connection`
and `cwd` and use the same resolver. Their owner HTTP routes also accept this selection.
The compatibility provider APIs operate on a resolved connection, not a parallel store.
New native provider operations must reuse this resolver rather than read unscoped keys.

The twelve native service definitions provide credential setup and verification.
This release does **not** add every service's entire API or replace provider-owned
OAuth clients. Explicit direct execution covers Dokploy project listing/ensure,
Cloudflare zone listing/DNS upsert, and Hostinger DNS upsert. Composio tool execution
is generic but restricted to the selected toolkit, active account and exec permission.

## Existing-data migration and concurrency

The protected store remains `OS_INFRA_STORE`, defaulting to
`~/.mso/private/infra-providers.json`. Reads project a v1 provider-only file into a
`legacy` profile without rewriting it. On the first successful mutation, MSO saves
an exact 0600 `<store>.v1-backup.json`, then atomically writes version 2. If both
Composio key types or both Convex auth methods were configured, they become separate
connections; the previous effective preference remains the default. Unknown or
malformed legacy data fails closed for review rather than being discarded.

No other application's store is imported automatically. Restore a backup only after
reviewing newer v2 changes; restoring old bytes is not a merge and would discard those
newer records. Stale forms carry connection UID/revision and cannot overwrite a
concurrently rotated, deleted or recreated identity. Deleting a folder-bound connection
or a Composio broker with linked dependants is refused until its references are handled.

## Security and verification limits

Credentials use protected filesystem permissions, atomic replacement and cross-process
locks. **This is not encryption at rest** and cannot protect against a compromised
owner/root account. Machine metadata schemas reject secret-shaped inputs recursively.

A setup token is a short-lived delegated write capability, not a separate cookie login.
Its hash is stored with the issuing principal and exact connection, with a ten-minute
expiry, bounded attempts, strict request sizes/Origins, and single-use successful save.
The bearer must remain private; requiring the Owner cookie inside a third-party iframe
would break the deliberate cookie-less secret submission boundary.

Tests cover legacy migration/backup, cross-user multi-deployment selection, actual
provider-client credential routing, folder/default precedence, external-source refusal,
confirmation/secret rejection, hosted identity/leases, stale setup grants, replay,
CLI/API/MCP parity and desktop/mobile/fullscreen browser behavior using synthetic data.
A real provider OAuth authorization or a user's save inside the actual ChatGPT host
is a separate user-authorized verification step, not implied by unit tests.

Official contracts: [MCP Apps](https://github.com/modelcontextprotocol/ext-apps),
[OpenAI plugin UI](https://developers.openai.com/plugins/reference), and
[Composio connected accounts](https://docs.composio.dev/docs/auth-configuration/connected-accounts).
