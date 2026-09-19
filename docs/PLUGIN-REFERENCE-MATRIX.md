# Plugin reference architecture matrix

> **Living reference.** This document tracks recurring architecture patterns observed while reviewing high-quality OpenAI/Codex/MCP plugin references. It is not a feature checklist and does not make a reference plugin authoritative over MSO. A pattern is promoted only when it is cross-domain or closes a concrete correctness, safety, portability, DX, or compatibility gap.

## Decision rules

- `ALREADY_STRONGER` — MSO already has the behavior with stronger or broader guarantees.
- `ALREADY_BUT_IMPROVE` — MSO has the concept, but the reference exposes a useful refinement.
- `NEW_GENERALIZABLE` — a reusable primitive is missing and evidence is strong enough to add it.
- `DOMAIN_SPECIFIC` — useful in the reference domain but not a core MSO primitive.
- `AVOID` — would reduce safety, privacy, portability, capability, or context efficiency.
- `WAIT` — promising, but one reference is not enough evidence for a new abstraction.

The matrix should be updated after each reference audit. `pending` means that plugin has not been audited yet; it does not mean the pattern is absent.

## Living matrix

| Pattern | Shopify | Plugin Management | GitHub | Gmail | Drive | Calendar | Notion | Analytics | Convex | Figma | Lovable | Sites | MSO current | Candidate primitive | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Structured skill routing/lifecycle contract | Strong reference; already adapted | Prose routing only in local snapshot | No skill source in saved snapshot; package/interface evidence only | pending | pending | pending | pending | pending | pending | pending | pending | pending | `contract.yaml` + `agents/openai.yaml` on official skills | Keep structured skill contract | `ALREADY_STRONGER` |
| Discover → validate → execute → verify | Strong reference; already adapted | Discovery/permission/dependency inspection is separated from mutation; connection must be verified before use | Partial: manifest promises connector-first workflows with targeted CLI fallback, but saved snapshot exposes no action source/schema | pending | pending | pending | pending | pending | pending | pending | pending | pending | Present across project MCP, database, workflows, integrations and action metadata | Universal lifecycle policy engine | `WAIT` — metadata must not become security authority |
| Package identity separate from live app/connection state | Partial evidence | Strong: Codex plugin package points to a required registered app; connection/permission state is managed separately | Strong: package binds an exact GitHub connector separately and marks it optional with `required:false` | pending | pending | pending | pending | pending | pending | pending | pending | pending | OpenAI package, project plugin, MCP, Integrations, App and Managed App are distinct but terminology was under-documented | Canonical extension taxonomy | `ALREADY_BUT_IMPROVE` — documented now |
| Reuse existing capability before discovering/installing a new extension | Not primary Shopify pattern | Strong: built-in → connected plugin → search new plugin | Strong: connector-first workflow with targeted CLI fallback | pending | pending | pending | pending | pending | pending | pending | pending | pending | Bounded-first and Integrations-first existed, but cross-surface ordering was implicit | Capability selection policy | `ALREADY_BUT_IMPROVE` — added to `/mso` guidance |
| Search separated from suggestion/install | Domain discovery is separate from actions | Strong: `search_plugins` is read-only discovery; `suggest_plugins` only proposes exact results and user action completes connection | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | Skills, projects and project MCP have separate discovery; Project Plugin catalog is small and install is explicit | Generic extension discovery/suggestion lifecycle | `WAIT` |
| Suggestion is non-blocking | Not established | Strong: continue independent work while user handles connection | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | Workflows can continue around missing integrations, but no universal suggestion state | Pending extension state | `WAIT` |
| Installed/pending duplicate prevention | State-aware mutations | Strong: do not suggest installed or already-pending plugins | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | Skill Market tracks installed/modified/conflict; project MCP inspect reports exact installed bindings | Generic extension state model | `WAIT` |
| Dependency metadata resolved separately from installation | Domain dependencies exist | Strong: dependency inspection reports canonical dependencies and user-aware status without installing | Strong: `.app.json` names an exact connector and explicitly declares optional dependency state | pending | pending | pending | pending | pending | pending | pending | pending | pending | `.app.json` maps OpenAI package→registered app; project plugin manifest declares skills/MCP, but there is no generic dependency graph | Dependency contract | `WAIT` |
| OpenAI app binding accepts registered apps/connectors with required-or-optional state | Required `asdk_app_*`; no package-level optional example in Shopify | Required registered-app binding | Strong: exact `connector_*` binding with `required:false`; public guidance also recognizes connector/template bindings | pending | pending | pending | pending | Strong: optional multi-app bindings use `optional:true`, categories and snake_case aliases | pending | pending | pending | pending | Canonical `asdk_app_`/`connector_`/`templated_apps_` IDs; optional/required booleans; snake/kebab aliases; URL-style `plugin_asdk_app_*` normalized before persistence | App-binding compatibility validator | `NEW_GENERALIZABLE` — implemented without changing authorization |
| Optional dependency may degrade transport but never identity/credential authority | No decisive evidence | Missing plugin may leave independent work unblocked, but no transport fallback evidence | Strong: connector-first with targeted CLI fallback and optional app binding | pending | pending | pending | pending | pending | pending | pending | pending | pending | Bounded tools/CLI/shell and multiple Integration sources already exist; source switching is deliberately explicit | Authority-preserving fallback policy | `ALREADY_BUT_IMPROVE` — documented now |
| Global permission default + per-extension override/inheritance | Not established | Strong: global permission mode plus app-specific override with `inherit` | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | OAuth `read < write < exec`, live device roles and per-operation confirmation are stronger security boundaries but semantically different | Permission policy overlay | `WAIT` — do not conflate platform UX permissions with MSO authorization |
| Explicit uninstall/remove only | Mutations are explicit | Strong: uninstall requires explicit user removal intent and exact targets | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | Project MCP delete is exact-project + revision guarded; Skill Market refuses unmanaged removal; App UI confirms uninstall; managed runtime uninstall is job-based | Shared removal UX vocabulary | `ALREADY_STRONGER` at enforcement level |
| Canonical identity instead of guessed identifiers | Strong target identity discipline | Strong: exact returned plugin IDs or unambiguous names; broad targets are refused | Strong at package boundary: exact `connector_*` identity is stored, not inferred from the provider name | pending | pending | pending | pending | pending | pending | pending | pending | pending | Exact project ids, skill ids, user/provider/connection and server aliases already fail closed on ambiguity | Generic identity resolver | `ALREADY_STRONGER` |
| Public legal/support metadata for submission | Present in Shopify package | Present: website/privacy/terms in package manifest | Present: website/privacy/terms plus repository/license/brand metadata | pending | pending | pending | pending | pending | pending | pending | pending | pending | MSO has real repository/website metadata but intentionally does not invent missing legal/support URLs | Submission metadata checklist | `WAIT` until real public surfaces exist |
| Target-aware capability resolver | Strong target/API legality concept | Partial: availability depends on built-ins, installed/connected state and dependency status | Partial: connector availability changes preferred transport while the package advertises a CLI fallback | pending | pending | pending | pending | pending | pending | pending | pending | pending | Target/action metadata + dynamic project/provider discovery exist, but no universal actor+project+surface+target+environment resolver | Capability resolver | `WAIT` — strengthened candidate |
| Bulk/partial-failure result contract | Strong Shopify candidate | No evidence in current Plugin Management schemas | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | No universal result shape | `BulkResult` | `WAIT` |
| Mandatory postcondition/refetch contract | Strong Shopify candidate | Partial: skill requires verifying installation/connection before claiming state | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | Verify metadata/evidence exists, but not every mutation has automatic postcondition execution | Postcondition runner | `WAIT` |
| Query/analytics DSL | ShopifyQL reference | No evidence | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | `read_pipeline` already supports select/filter/sort/unique/aggregate | Query DSL | `WAIT` for Analytics reference |

## Plugin Management audit — 0.1.0

Operator-local reference snapshot: `plugin-references/plugin-management/0.1.0` outside the portable MSO source tree.

### Architecture

The local package is deliberately thin:

```text
plugin-management/
├── .codex-remote-plugin-install.json   # remote plugin identity
└── 0.1.0/
    ├── .codex-plugin/plugin.json       # package/interface metadata
    ├── .app.json                       # required registered app dependency
    ├── assets/plugin-management.svg
    └── skills/plugin-management/SKILL.md
```

The package itself does not contain the runtime implementation of Plugin Management. Its local responsibility is packaging plus model routing. The installed app exposes the operational contracts for plugin search/suggestion, permissions, dependency inspection and uninstall.

### Behavior contract

1. Prefer an already available built-in capability.
2. Prefer an already connected plugin when it can finish the task.
3. Search the plugin directory only when an external app/account/service/data source would materially help and no available capability can access it.
4. Search with concise provider/capability terms, not the whole request.
5. Suggest only exact returned plugin identities; suggestions do not install/connect by themselves and must not block independent work.
6. Do not suggest already installed or pending plugins.
7. Treat permissions and dependencies as inspectable state, separate from plugin installation/connection.
8. Permission changes require the intended exact app and explicit or unambiguous requested mode; app-specific permissions may inherit the global default.
9. Uninstall requires explicit removal intent and exact targets.
10. Never claim installed/connected state without verification.

### Comparison with MSO

MSO is already stronger in exact target identity, trust levels, project isolation, credential isolation, CAS/revision guards, scoped OAuth authorization, dynamic MCP discovery, evidence receipts, shell escape-hatch preservation and removal safeguards. Plugin Management is clearer in one area: the model-facing mental model for choosing an existing capability versus discovering a new extension, and the separation between package identity, registered app dependency, connection state and permission policy.

MSO therefore should not collapse `Skill`, `Project Plugin`, `MCP`, `Integration`, `App`, and `Managed App` into one object. They own different authority. The immediate improvement is to make that taxonomy and routing order explicit. Generic dependency graphs, platform-style permission inheritance and suggestion state remain candidates until additional plugin references show the same pattern.

### Shopify candidate impact

- **Universal lifecycle engine:** mildly strengthened; Plugin Management also separates discovery/inspection from mutation, but does not prove a declarative universal runtime engine.
- **Knowledge/schema pack:** no supporting evidence in this snapshot.
- **Target-aware capability resolver:** strengthened; availability depends on currently available built-ins, installed/connected plugins and dependency state.
- **Bulk/partial failure result:** no supporting evidence.
- **Postcondition runner:** mildly strengthened by the explicit rule to verify install/connection before claiming state, but still not enough for an automatic generic runner.
- **Query/analytics DSL:** no supporting evidence.
- **Public submission metadata:** strengthened; Plugin Management also declares website/privacy/terms metadata.

### Decision

**Implement now:** canonical extension taxonomy and capability-selection routing guidance.

**Wait for more references:** generic plugin/extension search-and-suggest primitive, dependency graph, pending-install state, platform-style permission inheritance, universal lifecycle/postcondition engines, and public submission metadata beyond real URLs MSO already owns.

**Reject:** collapsing distinct MSO authority domains into a single generic “plugin” object, hiding existing low-level capabilities to mimic a simpler plugin product, or allowing package metadata to become an authorization/security authority.

## GitHub audit — 0.1.12-5f7cd798dc99

Operator-local reference snapshot: `plugin-references/github/0.1.12-5f7cd798dc99` outside the portable MSO source tree. The saved package contains only `.codex-plugin/plugin.json`, `.app.json`, remote-install metadata, and brand assets; it does **not** contain GitHub action implementations, `SKILL.md`, or `.mcp.json`. Action-level pagination, mutation, and concurrency behavior therefore cannot be attributed to this package snapshot.

### Architecture

```text
github/
├── .codex-remote-plugin-install.json
└── 0.1.12-5f7cd798dc99/
    ├── .codex-plugin/plugin.json   # workflow/presentation metadata
    ├── .app.json                   # optional exact connector binding
    └── assets/                     # GitHub brand assets
```

The manifest describes a hybrid workflow: inspect repositories, triage PRs/issues, debug CI and publish changes with a **connector-first** path plus **targeted CLI fallbacks**. `.app.json` binds the exact GitHub connector id with `required:false`, proving that an app binding is not always a hard package dependency. The package metadata also carries website, privacy, terms, repository, license, brand and task-shaped default prompts.

### Comparison with MSO

MSO already has the stronger execution boundary: bounded native/project/provider capabilities first, scoped shell only when required, explicit named credential identities, no silent source fallback, revision/CAS checks and evidence verification. The GitHub reference exposes two compatibility refinements. First, OpenAI app bindings may be connector identities rather than only registered `asdk_app_*` ids. Second, `required` is a boolean dependency declaration, not a constant `true`. MSO's plugin checker was stricter than the observed valid format, so it now accepts canonical registered-app, connector and documented template binding IDs, both `required` and `optional` booleans when present, and the snake/kebab aliases used by saved reference packages. A `plugin_asdk_app_*` URL identifier is normalized by the linker and is never persisted into `.app.json`. This changes validation compatibility only; package metadata still grants no credential, MCP, host, or provider authority.

For optional capabilities, MSO now states the fallback rule explicitly: transport may degrade only through an already-authorized, explicitly selected identity while preserving scope. A missing provider-owned connector must never cause a silent switch to another user, connection, local token, or copied OAuth credential.

### Shopify / Plugin Management candidate impact

- **Universal lifecycle engine:** unchanged; GitHub's saved snapshot does not expose enough action lifecycle source.
- **Target-aware capability resolver:** strengthened because preferred execution depends on connector availability, while fallback remains possible.
- **Dependency contract:** strengthened materially; required and optional app dependencies are both now evidenced. A generic dependency graph still needs more references before runtime implementation.
- **Postcondition runner:** no new package-level evidence.
- **Bulk/partial failure result:** no package-level evidence.
- **Query/analytics DSL:** no evidence.
- **Public submission metadata:** strengthened again, but MSO should not invent privacy/terms URLs that it does not own.

### Decision

**Implement now:** broaden OpenAI app-binding validation to valid connector/template identities and boolean `required` state; document authority-preserving optional fallback.

**Keep as existing strength:** connector/bounded capability first, targeted CLI/shell fallback, exact credential identity, explicit source selection, and verification.

**Wait:** generic dependency graph, universal capability resolver/runtime fallback engine, and missing MSO-owned legal/support publication surfaces.

**Reject:** treating `required:false` as permission to silently switch credential authority or principal, and inferring unobserved GitHub action semantics from package marketing text.
