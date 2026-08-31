# Infrastructure providers and MSO Agent

> **Current reference.** This is the contract for the interactive `mso` agent and the
> provider-backed deployment layer. Provider credentials are owner-local state; they are
> never part of the model prompt or MCP tool arguments.

MSO now owns the deployment-assistance pattern that previously lived separately in
`rahmanef63/si-coder-agent`: provider discovery, live API verification, bounded Dokploy
operations, and DNS automation. The implementation is native MSO code rather than a nested
`si-coder-agent` runtime, so the browser features, CLI, terminal agent and MCP surface share
one catalog and one security/audit model.

## 1. Terminal entry points

Bare `mso` is the interactive setup/operations agent:

```bash
mso                         # launch MSO Agent
mso agent                   # explicit alias
mso model                   # connect/change the AI provider
mso setup                   # guided setup (alias of `mso onboard`)
mso provider list           # masked infrastructure status
mso provider set dokploy    # hidden terminal prompts
mso provider set cloudflare
mso provider set hostinger
mso provider doctor         # live-check every configured provider
mso provider projects       # Dokploy projects
mso provider zones          # Cloudflare zones
```

When no AI provider is connected, `mso` runs the same interactive provider flow as
`mso model` before the agent starts. The current model connection choices are OpenAI
ChatGPT/Codex device OAuth plus the built-in API-key providers documented in
[`INSTALL.md`](./INSTALL.md).

The terminal UI intentionally follows the useful *shape* of mature agent CLIs such as
Hermes — large identity banner, selected model, tool/skill/provider summary, then an
interactive prompt — but uses original MSO ASCII artwork and MSO's own tool/runtime stack.

Agent slash commands are:

```text
/model  /setup  /providers  /provider <id>  /doctor
/tools  /skills  /clear     /exit
```

## 2. One tool catalog, two transports

`scripts/mso-agent.mjs` does not invent a second host-tool implementation. It asks the
owner-only `/api/v1/agent-tools` bridge for the canonical `lib/mcp/*` catalog and sends those
schemas to `/api/assistant`. Tool execution comes back through the same MCP dispatcher.

```mermaid
flowchart LR
  T[bare `mso` terminal] --> A[/api/assistant]
  T --> G[/api/v1/agent-tools]
  G --> M[canonical MCP dispatcher]
  M --> H[bounded host/project tools]
  M --> I[lib/infra provider clients]
  I --> D[Dokploy]
  I --> C[Cloudflare]
  I --> HS[Hostinger]
```

Read tools may run immediately. Every `write` or `exec` request from the terminal pauses on
an exact-call approval prompt; there is no session-wide mutation allowlist. MSO renders the
complete canonical tool name + nested input before approval, shows its SHA-256, and the server
recomputes that digest before dispatch so changing any field invalidates approval. Calls larger
than 32 KiB are refused by the terminal agent rather than approved from a truncated preview.
The server independently requires an Owner session, applies the deployment's MCP scope ceiling,
re-checks the tool scope, rate-limits the operation and writes its normal audit trail. Terminal
approval is therefore an additional interaction guard, not a replacement for server authorization.

## 3. Credential boundary

Provider state defaults to:

```text
~/.mso/private/infra-providers.json
```

The directory is `0700`; the file is `0600`, owner-checked, regular-file checked, size-bounded
and opened with `O_NOFOLLOW`. Writes are serialized through the security-store lock and
published atomically.

Secret fields are entered with terminal echo disabled or through password inputs in the
Dokploy/Cloudflare feature apps. API-key JSON is posted from stdin; the key is not placed in
`jq`, Node, or curl argv. API reads expose only the word `configured` for secret fields; no token prefix/suffix leaves the server. Agent/MCP schemas do
not contain credential parameters at all: the server-side provider client loads the secret
only when the approved operation actually runs.

Do **not** paste an API token into an MSO Agent conversation. If an agent says a provider is
missing, run `mso provider set <id>` in the terminal and then ask it to re-check.

## 4. Dokploy

Dokploy is a default MSO feature app and an agent provider. Configuration fields are:

- `apiUrl` — required. Remote endpoints must use HTTPS; loopback development/runtime URLs may
  use HTTP. `/api` is normalized automatically.
- `apiKey` — required secret.
- `publicIp` — optional explicit public IPv4 used by deployment workflows. MSO never derives a
  public DNS target from a loopback Dokploy URL.

Remote Dokploy requests use the existing DNS-pinned safe-provider transport: private,
link-local and metadata resolutions are refused and redirects are not followed. Literal
loopback is the only local exception. The first bounded operations are project listing and
idempotent project creation/ensure, with retry/backoff on transient upstream failures.

The provider is intentionally narrower than the old standalone deployment scripts. Add each
new Dokploy mutation as a typed, validated, tested tool rather than turning the API key into a
generic arbitrary-request primitive.

## 5. Cloudflare

Cloudflare is a default MSO feature app. The provider stores an API token plus optional zone
and account pins. Use the smallest token scope that covers the zones MSO must manage.

DNS automation is deliberately per-record:

- supported types: `A`, `AAAA`, `CNAME`, `TXT`;
- exact zone containment and exact record lookup;
- ambiguous duplicates are refused rather than guessed;
- conflicting `CNAME` versus address records are refused rather than deleted/replaced;
- existing records use `PATCH`; new records use `POST`;
- no bulk zone `PUT` exists;
- Cloudflare proxying defaults **off** and is enabled only when `proxied=true` was explicitly
  requested.

This preserves the safest part of the `si-coder-agent` Cloudflare pattern while putting it
behind MSO scope, approval, audit and workflow controls.

## 6. Hostinger

Hostinger is available as an infrastructure provider because many MSO deployments use hPanel
for their domain. It is not a default shell app; Dokploy and Cloudflare are the two default
infrastructure apps requested for the MSO workspace.

Hostinger's zone update API supports scoped RR-set replacement: with `overwrite:true`, only records matching the supplied `name + type` are replaced. MSO therefore verifies portfolio ownership, reads the zone only for ambiguity/conflict checks, and PUTs **one** requested RR-set. Unrelated rows are never included in the mutation payload, so a concurrent update elsewhere in the zone cannot be lost through MSO. The write remains approval-gated because changing DNS is externally visible state.

## 7. Current infrastructure tools

| Tool | Scope | Purpose |
|---|---|---|
| `infra_providers_list` | read | masked provider/configuration inventory |
| `infra_provider_doctor` | read | live provider API check |
| `dokploy_projects_list` | read | bounded Dokploy project discovery |
| `dokploy_project_ensure` | write | idempotently create a missing project |
| `cloudflare_zones_list` | read | bounded accessible-zone discovery |
| `cloudflare_dns_upsert` | write | exact one-record Cloudflare create/update |
| `hostinger_dns_upsert` | write | replace one exact Hostinger name/type RR-set |

For multi-step project deployment, the official
[`mso-project-deploy`](../claude-skills/mso-project-deploy/SKILL.md) skill requires
`workflow_start` → inspect/plan → provider doctor → bounded operations → runtime/domain
verification → `workflow_finish`. A provider credential is never an excuse to skip project
inspection or verification.

## 8. Adding another provider

A provider is not complete merely because MSO can store its token. A new integration must add:

1. a registry definition with required/optional and secret fields;
2. strict normalization/validation;
3. private-store tests, including secret non-disclosure;
4. a live read-only doctor probe;
5. bounded provider-client operations with timeout/retry and SSRF/redirect policy appropriate
   to configurable endpoints;
6. scoped MCP tools with rate limits and audit classification;
7. an explicit Alfa/MCP parity exemption or corresponding in-app capability;
8. CLI/UI exposure only after those contracts pass;
9. docs plus the normal repository/security gates.

Prefer provider-native exact operations over generic `curl`/shell automation. Generic shell
remains the escape hatch, not the product API.
