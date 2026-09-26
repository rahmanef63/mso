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


### Integration Variables

Integration Variables are global, metadata-only aliases to an existing named connection,
for example JEV → credential-user / mcp / jev. This JEV alias is now a legacy/diagnostic MCP override; native Jev optimization uses the OpenRouter key from the shared AI Provider store. A variable stores only provider, user and
connection references; it never copies endpoint, API key, bearer token, OAuth bundle or
connection field values. Names use uppercase A-Z, 0-9 and underscore. integration_manage
owns variable.set / variable.delete, while integration_query with view=variables returns
only those safe references. User rename updates references. Deleting a referenced
user/connection is refused until the variable is removed or retargeted.

When a pre-variable v2 store already contains one unambiguous mcp/jev connection, the
upgrade projection seeds JEV in memory. An explicitly stored variable map, including an
explicit empty map, wins and is never silently re-seeded. This gives existing Jev installs
a safe default without hardcoding an operator/user ID.

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

## Ownership and managed SI-Coder

MSO Integrations owns provider/account authority. Batonly owns project plans, task state,
project-to-connection bindings, QA and delivery evidence; it must not mirror provider secrets.
SI-Coder remains optional portable developer tooling. Its standalone store is unchanged.

The shell now exposes **Integrations** in Dock, Launchpad and the App Store, with a pinned
mobile shortcut. `/connections` opens the addressable shell window; `/integrations` remains
the standalone compatibility entrypoint for secure setup links and terminal workflows. Its same-origin
`/integrations/manager` document reuses the existing native service/form and nonce policy;
that internal document, `/integrations/embed`, and the compatibility alias `/integrations?embed=shell` permit same-origin framing. Other origins remain blocked.
Transfer and private setup fragment handoffs remain supported without copying field values.

Settings → MCP → **MSO Access → Project plugins** separates the available plugin catalog from installed project bindings.
Every project starts with no SI-Coder or Batonly plugin. Select one exact project, inspect its revision, then explicitly **Install to project** or **Uninstall**. Parent and sibling `.mcp.json` files are never inherited. Custom manifests remain browser-local declarations only. The catalog is not runtime authority; the selected project's `.mcp.json` is. Installed is deliberately **not** labelled verified; use `project_mcp_tools` and then `project_mcp_call` for real discovery/execution evidence.

For an MSO-managed SC binding, use `project_mcp_manage` with `plugin: "si-coder"` instead
of `url`, retaining the revision returned by `action: "inspect"`. The portable binding is:

```json
{"mcpServers":{"si-coder":{"plugin":"si-coder","credentialAuthority":"mso"}}}
```


Batonly uses the same project-install contract. Its project file stores only the reviewed plugin identity plus an exact private MSO connection reference; it does not duplicate the Batonly endpoint or access token:

```json
{"mcpServers":{"batonly":{"plugin":"batonly","credentialAuthority":"mso","integration":{"user":"owner","connection":"batonly-assistant"}}}}
```

The named `mcp` connection in Integrations must resolve to the reviewed Batonly endpoint before installation succeeds. Removing this binding affects only the selected project; it does not revoke the credential, delete Batonly data, or change another project.

The installed package is resolved by its declared package/bin identity, not the name of a
worktree directory. An unrelated system command named `sc` is never executed as SI-Coder.
This mode exposes reviewed workspace utilities and redirects supported SC account/catalog/
connection-status/verification functions to native MSO. Verification requires explicit
`user`, `provider`, and `connection`; there is no fallback to standalone SC accounts.
SC store mutations, import/export and unaudited flow execution are not exposed in managed
mode. Provider deployment operations continue through `integration_execute`; credentials
are neither copied nor silently synchronized. Standalone SC retains its complete own surface.

This is not an operating-system sandbox for installed code. Activating and calling a local
MCP still requires trust in the installed package and the existing MSO exec-scope approval.
The managed dispatch boundary prevents accidental use of SC's parallel credential workflow.

## Browser and ChatGPT

Open `/integrations`. Public instructions are readable before sign-in; an Owner
session is required to read/manage credential profiles or open their private forms.
Choose the credential user, provider, named connection, source and authentication.
The browser workbench uses the same master/detail navigation grammar as Settings.
Desktop uses the shared Settings sidebar/content measure tokens; compact windows turn the
same sidebar into an accessible drawer. Providers live under **Connections**. Visual
surfaces, accent, typography, radius and spacing come from the shared semantic token
contract, and the native iframe synchronizes those tokens from the active AppShell.
**AI Providers**, **Variables**, **Credential owners**, **Project routing**,
**Transfer & backup**, and **Add project MCP** live under **Manage**. The AI Providers tab
reuses the existing Alfa /api/config, /api/models/providers, /api/models, /api/models/test,
and /api/oauth/openai services as its single source of truth: active provider/model
selection, API-key updates, provider tests, OpenAI account authorization, custom-provider
creation and disconnect all use the same runtime/config store as Settings. It does not
create an Integrations copy of AI credentials. Section state stays selected when the
credential owner changes, and Transfer & backup renders in the detail pane instead of
replacing the navigation.
The secure credential-entry form remains an intentional drill-down from a connection.

When an agent needs external access, it must inspect Integrations before asking for a new
credential. Resolve the exact project/context → credential owner → provider → named
connection first. Only open setup when no suitable connection exists. Credential values
belong in the private setup/export surfaces, never chat or MCP tool arguments.

A direct named connection can also be **shared** to another credential user as a
read-only alias. The alias resolves the owner's current backing credential at use time,
so rotations propagate without copying a second plaintext value. Alias metadata can be
renamed or selected as that user's default, but credential edits and re-sharing are
refused. Backing connection/user deletion is blocked while dependents exist; **Unshare**
removes only the alias. User duplication materializes an incoming alias into an
independent direct connection: metadata-only by default, or values only with the
explicit `copyCredentials` opt-in. External linked identities are never copied into a
different profile.

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

## MSO Chat / Agent

`/integrations` is the primary product-facing slash command in MSO Chat/Agent. With no arguments it opens the same Finder-style native Integrations manager; explicit CLI-style arguments are passed through for advanced use. `/provider` and `/providers` remain executable compatibility aliases but are intentionally hidden from slash discovery so credential setup has one canonical name.

```text
/integrations
  → Credential user → Provider → Named connection → Source/Auth → Actions
```

Credential values still enter only through the private setup flow; the Agent conversation and slash-command payload never carry provider secrets.

### Local SI-Coder migration

When a verified `si-coder-agent` package is present at `~/.local/bin/sc`, `mso integrations` automatically detects its **metadata-only** Integration Bundle and shows **Import from SI-Coder** in Transfer. Detection is read-only; applying the preview is an explicit create-only action. Existing MSO identities are preserved. Direct credential values are never copied silently; move them with the encrypted bundle/private transfer flow. MSO remains fully standalone when SC is absent. The equivalent explicit command is `mso integrations import-sc`.

## CLI

Bare `mso integrations` is an MSO-native Finder-style alternate-screen application. It repaints one complete terminal frame by absolute cursor position, uses terminal-cell-aware width calculation, and reserves the rightmost physical cell to avoid Windows Terminal/SSH wrap drift. Borders are one continuous `─/│` grid; there are no placeholder columns.

```text
 MSO  Integrations                                      rahmanfakhr / hostinger / default
 SECTIONS   1:Connections   2:Users   3:Providers   4:Transfer
 PATH       MSO › Connections › rahmanfakhr › Hostinger › Hostinger account
 FILTER     / to filter current column

┌──────────────────────┬──────────────────────┬──────────────────────┬──────────────────────┐
│ Connections          │ rahmanfakhr         │ Hostinger            │ Hostinger account    │
├──────────────────────┼──────────────────────┼──────────────────────┼──────────────────────┤
│ › rahmanfakhr        │ › Hostinger         │ › Hostinger account  │ · Set credentials    │
│                      │   GitHub             │   Mail production    │ · Verify             │
│                      │   Convex Cloud       │                      │ · Route              │
└──────────────────────┴──────────────────────┴──────────────────────┴──────────────────────┘
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ INSPECTOR  Verify — live API/auth status                                                   │
│ Connection: Hostinger account · Source: direct · Scope: account · State: verified          │
└────────────────────────────────────────────────────────────────────────────────────────────┘
 ↑↓ move  ←→ columns  Enter open/run  / filter  V verify  R route  S setup  D default  ? help
```

Responsive rules are terminal-column based: `>=132` shows up to four Finder panes, `92–131` three, `68–91` two, and `<68` the deepest pane only. Fewer actual ancestry panes render fewer columns instead of blank placeholders; PATH keeps omitted ancestry visible. The lower Inspector becomes Result after an operation and then returns to metadata preview on the next navigation input.

Keyboard navigation: `↑/↓` moves in the active pane; `→`, Tab or Enter opens a branch; `←`/Esc returns exactly one level; `/` enters filter mode and only filters the active pane; `1–4` switch sections; `V/R/S/D/N` verify, route, secure setup, make default, and create a connection when the context supports them; `E/I` open transfer export/import; `?` shows help; Ctrl-D exits. Selection and filter text are remembered per Finder layer while the process remains open.

The Inspector contains only labels, IDs, source/backend, auth method, scope, state, configured-field counts, guidance/reference metadata and redacted operation results. Credential values never enter the Finder model, frame buffer, temp config, argv, logs or MCP arguments. Direct secret entry remains in the private setup form. Composio authorization remains provider-hosted.

Connections extend through **user → provider → named connection → actions**. New connection creation extends through **source/backend → authentication method → create**. User lifecycle, provider catalog, folder resolution, JSON transfer and Hostinger Mail are part of the same Finder navigation model. Hostinger Mail actions show bounded/redacted results in the Result inspector instead of dumping raw JSON into terminal scrollback.

Explicit commands remain stable for scripts and agents, and a bare non-TTY invocation still returns the machine-readable snapshot:

```sh
mso integrations create-user rahman "Rahman"
mso integrations request rahman convex-cloud
mso integrations create-connection rahman convex-cloud mimin-production direct deployment
mso integrations connections rahman convex-cloud
mso integrations setup rahman convex-cloud mimin-production
mso integrations verify rahman convex-cloud mimin-production
mso integrations resolve rahman convex-cloud mimin-production
mso integrations | jq
```

`setup` prints a private ten-minute fragment URL only in an interactive terminal. Do not paste it into chat or logs. `mso provider setup <provider> <user> <connection>` remains a compatibility entrypoint to the same flow.

Metadata changes still use the native confirmed management API:

```sh
mso integrations manage '{"action":"folder.map","user":"rahman","path":"/absolute/project","provider":"convex-cloud","connection":"mimin-staging","confirm":true}'
mso integrations which /absolute/project
mso integrations execute '{"user":"rahman","provider":"dokploy","connection":"production","operation":"dokploy.projects.list","confirm":true}'
```

## Machine tools and operation coverage

`integration_query` reads catalog/users/connections/Integration Variables, resolves an
identity, and returns source-aware setup instructions. `integration_manage` performs
confirmed user, connection, Integration Variable, folder-binding, credential-deletion or
hosted-authorization actions.
`integration_execute` takes explicit user/provider/connection and returns a route,
verifies that connection, performs supported bounded direct operations, executes
a toolkit-matching Composio tool using its exact connected account, or calls one exact
tool on a named direct `mcp` connection through `mcp.tool`. `mcp.tools.list` exposes the
downstream tool catalog after the connection allowlist is applied. The bearer credential
is resolved inside the transport and never appears in model/tool arguments.
`integration_setup_open` requires `user`, `provider` and `connection`; optional `method`
must match the connection. Its private grant exists only in result `_meta` for the UI.

Existing Dokploy, Cloudflare and Hostinger MCP tools now accept `user`, `connection`
and `cwd` and use the same resolver. Their owner HTTP routes also accept this selection.
The compatibility provider APIs operate on a resolved connection, not a parallel store.
New native provider operations must reuse this resolver rather than read unscoped keys.

SI-Coder's runtime **custom-provider definition CRUD** is intentionally not mirrored
into MSO's reviewed execution catalog yet. MSO's provider IDs are also operation guards:
turning arbitrary metadata into executable providers would weaken the bounded-tool
contract. Custom provider schema editing therefore remains SC-owned until MSO has a
separate metadata-only dynamic registry whose entries cannot acquire network/exec
capabilities implicitly. This is a deliberate safety boundary, not a hidden or fake
browser control.

The twelve native service definitions provide credential setup and verification.
This release does **not** add every service's entire API or replace provider-owned
OAuth clients. Explicit direct execution covers Dokploy project listing/ensure,
Cloudflare zone listing/DNS upsert, and Hostinger DNS upsert. Composio tool execution
is generic but restricted to the selected toolkit, active account and exec permission.
Named direct MCP execution is likewise restricted to the selected endpoint/token and its
optional exact `allowedTools` list; it is not an arbitrary URL/request escape hatch.

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

## Move identities between standalone projects

Open **Integrations sidebar → Transfer & backup** or `/integrations?transfer=1`.

- **Encrypted JSON** is the default/recommended backup and may carry selected direct
  credential values behind a separate backup passphrase.
- **Metadata JSON** never contains credential values.
- **Raw JSON** and **.env** are deliberate plaintext exports. They are Owner-only and
  require the current MSO owner password. The server issues a 90-second, one-time grant
  bound to the selected connection tree; the grant is consumed by one download and the
  password is not stored in the export state or audit log.
- **All connections / Custom selection…** uses a checkbox tree of credential owner →
  provider → named connection. Raw formats include direct stored values only; external
  OAuth/provider sessions are never converted into local secrets.

Imports remain preview-first, create-only, unverified, and never overwrite existing
connections or silently change defaults/folder bindings. **Share linked access** keeps
one owner/backing secret; **Copy to another owner** creates an independent connection
and copies direct values only when explicitly selected. See [Integration Bundle v1]
(INTEGRATION-PORTABILITY.md) for portable bundle details.

## Hostinger Mail API

Hostinger is one provider with two direct connection methods:

- **Account API token** — existing Hostinger account credential. It can keep serving VPS/DNS and can enumerate Mail API orders when that account has Hostinger Email.
- **Scoped Mail API token** — a dedicated named connection bound to one Hostinger mail order. Store the Mail API token together with that order ID; MSO refuses a different order at execution time.

The native connection executor supports read-only mail-order/plan/resource/log operations plus reviewed non-secret mailbox management for aliases, forwarders, autoreplies, catch-alls and mailbox deletion. Mailbox creation/password rotation, webhook creation/regeneration, and Mail API-token creation are deliberately not accepted through model/tool JSON because those operations create or consume secret values. Use a private Hostinger/browser flow for those secrets.

Official reference: <https://developers.hostinger.com/> → **Mail**. The API documents Mail Orders, Mailboxes, Aliases, Autoreplies, Forwarders, Catchalls, Webhooks, API Tokens and Logs under `/api/mail/v1`.

## Telegram and Discord for Channels

Telegram and Discord are native direct Integration providers used by MSO Channels. Channel configuration never stores bot credentials.

Telegram direct connections store the Bot API token plus an optional webhook secret. Verification uses Bot API `getMe`; the webhook secret becomes mandatory only when the connection is used for inbound Channels delivery.

Discord direct connections store the bot token and may also store the non-secret application ID and Interactions Ed25519 public key. Verification uses Discord REST bot identity. The public key is required before signed Discord Interactions can be accepted. Gateway event ingestion is intentionally not implied by a verified Discord connection.

The Channels application resolves an exact credential user + named connection. If no compatible connection exists, setup remains in Integrations rather than exposing a token field inside Channels. See [CHANNELS.md](./CHANNELS.md).


## Native Google OAuth: Search Console and GA4

MSO can own Google authorization directly; Composio is optional, not required.
Configure a same-owner `google-oauth-app` once through private setup, then bind
`google-search-console` or `google-analytics` named connections and authorize the
intended account in the native Owner browser. These private reporting APIs are
OAuth-only in this slice; an API key or GA measurement ID is not a substitute.

`mso integrations authorize <user> <provider> <connection>` opens the native
consent entrypoint without returning an OAuth code or state. Google web callback
routes are browser-bound protocol controls, unlike device-code provider flows.
The existing generic `integration_execute` exposes schema-listed read operations,
verification, app binding and local disconnect. No per-provider global MCP tool
or parallel credential store is added.

App configuration is not verified account access. Native Google user grants are
never shared, copied to another owner or exported, including encrypted/raw
credential formats. Read [Native Google integrations](./INTEGRATIONS-NATIVE-GOOGLE.md)
for setup, states, operations, security and the remaining Composio-class parity roadmap.
