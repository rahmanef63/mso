# The Alfa contract

What an **Agent**, a **Playbook**, a **Tool** and a **Skill** each are in MSO, where
the single source of truth for each lives, and what actually reaches the model.

Written because four of these had drifted into fiction: a 45-entry tool catalog the
model could never call, agent tool-scoping that configured nothing, and two
unrelated things both called "skill".

---

> **Where this lives, and how to not lose it.** Agents, Skills and Automations are
> per-browser localStorage (`alfa.*`), so clearing site data destroys them and there
> is no server copy. **Settings → Backup** exports every mso-owned key as one JSON
> file and imports it back. The `alfa.` prefix is matched by rule, so a new
> `alfa.something` key is covered automatically; a key outside every prefix has to be
> added to `MSO_LOCAL_STATE.extra` in `appshell/lib/local-state.ts` or it silently
> will not be in the backup.

## Tool

**An operation the model can actually invoke.** If it is not here, *Alfa* cannot do
it — this is the whole list **for Alfa**.

It is NOT the whole list for the box. `lib/mcp/tools.ts` is a second, deliberately
separate catalog for MCP clients (ChatGPT / Claude.ai / Cursor) — different
transport, different guard (a scope tier, not an approval card), different
handlers. See `docs/MCP.md`. The two are allowed to differ; they are not allowed
to differ by accident, which is what the coverage test in
`frontend/slices/assistant/host-tools/registry.test.ts` exists to catch.

| | |
|---|---|
| Shape | `HostTool` — `frontend/slices/assistant/host-tools/types.ts` |
| Source of truth | `host-tools/catalog.ts` (read) + `catalog-mutate.ts` (mutate) → `HOST_TOOLS` |
| Lifecycle | Static array, compiled in |
| Written by | Developers only |

Every tool declares `effect`:

- **`read`** — runs immediately.
- **`mutate`** — parks an approval card and waits for a human before touching the
  VPS. The rendezvous is `appshell/lib/alfa-approvals.ts`, so *any* surface showing
  the card can answer it (the Assistant app, the desktop dock, the mobile sheet).

`group` and `label` are presentation only and are never sent to the model.

`OS_TOOLS` (`lib/tools.ts`) is a **view** of `HOST_TOOLS` for the pickers. It is
derived, never authored. `lib/tools.test.ts` fails if the two ever diverge.

## Playbook (the localStorage `Skill` type)

**A named bundle of instructions a user assembles.** Shown in the Assistant's **Playbooks** tab.

| | |
|---|---|
| Shape | `Skill` — `lib/types.ts` |
| Source of truth | `localStorage["alfa.skills"]`, seeded from `PRESET_SKILLS` |
| Lifecycle | Per browser, user-editable |
| Written by | The user, via the Playbooks tab |

Tool ids are MIGRATED on read (`lib/store.ts` `migrateRows`), not dropped: a bundle
saved before the catalogs converged has its old ids mapped to the current ones, and
only ids that never had an executable counterpart are removed. Dropping instead of
mapping would have emptied the five builtin bundles for every existing install —
`store-migration.test.ts` is what holds that line.

> **Naming.** The persisted TypeScript type remains `Skill` for compatibility, but the
> product surface calls it **Playbook**. This avoids colliding with host `SKILL.md`
> while preserving existing `alfa.skills` backups and migrations.

## Skill (a `SKILL.md` on disk)

**A markdown playbook on the host.** Nothing to do with the type above: different
shape, different storage, different lifecycle, and the names do not overlap.

| | |
|---|---|
| Shape | `{ id, name, path, description, source, trust, project?, provenance? }` — `lib/skills/catalog-types.ts` |
| Source of truth | `GET /api/skills` — explicit operator root → official repo skills → hash-verified bundles → generic HOME discovery roots → **per-project roots of every project on the box** |
| Lifecycle | Files on disk; trust is derived from root/provenance/ownership, never self-declared by the skill |
| Written by | MSO, the operator, a project checkout, or discovered agent registries |

The model reaches trusted skills through the `skills.list`, `skills.search` and `skills.read` **tools**. `official`, hash-`verified`, explicit operator `local` and ownership-verified project skills are executable by default; generic discovered skills are cataloged as `untrusted` but their instructions are not fed directly to the model. `/skill` follows the same trust filter. There is no separate execution path.

**Discovery is global, and addressed by id.** Skills come from every project across
every configured project container (each `OS_FS_READ_ROOTS` entry and its `projects/`
child), from `.mso/skills`, `.claude/skills`, `.hermes/skills`, `.agents/skills` and
`.codex/skills`. A global skill's id is its bare name; a project skill's is
`<rootId>/<project>/<name>`, where `rootId` is a 128-bit hash of the canonical container
path (32 bits collided in practice) — so two projects with the same basename in
*different* configured roots stay distinct, and neither can shadow an operator or official skill. A project skill earns
`local` trust only after realpath containment inside its project, ownership by MSO's uid,
and a regular non-symlink `SKILL.md`; the generic HOME agent roots stay untrusted.
`skills.read` takes the exact id and refuses an ambiguous bare name rather than guessing.
Every response carries a scan report, so a truncated catalog is never presented as
complete. See [`docs/MCP.md`](../../../docs/MCP.md) and [`skills/README.md`](../../../skills/README.md).

## Agent

**A persona.** Currently that, and only that.

| | |
|---|---|
| Shape | `Agent` — `lib/types.ts` |
| Source of truth | `lib/store.ts` — a MODULE store over `localStorage["alfa.agents"]` |
| Lifecycle | Per browser, user-editable |
| Written by | The user, via the Agents tab or an `@mention` pick |

The store is module-level (same shape as `appshell/lib/alfa.ts`), so the Alfa sheet
and the desktop dock can read and switch the agent without the Assistant app being
mounted. Read it with `activeAgent()` — **never** cache it in a ref: `sendToAlfa`
can invoke the engine synchronously in the same tick as a switch, so a ref would
still hold the previous agent and the first turn after an `@mention` would carry
the wrong persona.

---

## Alfa Cockpit: one execution surface, existing sources of truth

The Assistant chat now has a compact **Cockpit** bar + responsive panel (desktop side panel, mobile drawer). It is a presentation/read-model over existing MSO domains, not a second runtime:

- `GET /api/v1/alfa/cockpit` owner-gates and aggregates model selection, bounded/searchable project discovery, selected-project Git/package/capabilities/knowledge metadata, native session summaries, same-principal local-agent presence, the legacy Alfa fact count, and typed-memory state.
- Project search has a lightweight `?q=` path so the first bounded page is not treated as the whole host. A truncated scan is shown as incomplete rather than as an absence claim.
- The selected project id persists under `alfa.selectedProject`, so Settings → Backup includes it automatically. The loaded snapshot is shared with the dock/mobile Alfa surface.
- Host `SKILL.md` rows stay on the existing `/api/skills` SSOT and lazy-load only when Cockpit opens. `untrusted` rows are visible for review but are not one-click executable; trusted rows send an exact-id `skills.read` request through Alfa's existing host-tool loop.
- Typed memory is owner-visible as metadata/current records, but non-`normal` keys/values are masked as `Private memory`. Raw `KNOWLEDGE.md` content and raw repo-memory bodies are not copied into the Cockpit response.
- `Activity & Runs` merges client-side Alfa host-tool events with server MCP workflow activity only at the presentation layer. The execution engines remain separate; this is observability, not a fake shared workflow id.
- Native MSO Agent sessions shown in Cockpit are **read-only summaries** and are explicitly separate from Alfa's browser YAML chat threads.
- Provider/credential management remains Settings' responsibility. Cockpit can switch/test a model only inside the provider that is already configured.

Browser Automations likewise do not introduce a second executor. `Run` turns the saved ordered recipe into one Alfa task; the normal host-tool schemas, server guards, and approval rendezvous remain the execution path.

## What actually reaches the model

Exactly three things, assembled in `chat-panel.tsx`:

1. **System prompt** — `composeSystem(agent, modeNote, projectContext)` in `lib/agent-request.ts`,
   the ONE place that decides this. It contains `HOST_SYSTEM`, the live/mock note, an optional **bounded selected-project metadata snapshot**, then the active agent's name/persona. Raw knowledge and repo-memory bodies are not injected. It is rebuilt **every turn**, so agent/project switches take effect on the next request. Because the route has one cache breakpoint at the end of the system block, a changed persona/project suffix can still miss that provider cache; keeping the global tool array stable avoids adding another source of prompt-prefix variation.
2. **Tools** — `HOST_AI_TOOLS`, i.e. *all* of them, always. See the scoping decision.
3. **History** — the wire turns. Nothing else. The persona is not in here.

Callers with their own tools pass their own system prompt. The image editor does
**not**, so it runs on the route default in `app/api/assistant/route.ts` — that
constant is reachable and must not be deleted as dead.

## Decided: tool scoping is deleted, not repaired

Every agent gets **every** tool, on every turn — no per-agent, no per-playbook, and no
per-project filter. This is the contract, not a gap. `registry.test.ts` pins it: the
`HOST_AI_TOOLS` array is the whole catalog in catalog order, it is the same object on
every turn, and `registry.ts` exports nothing that could narrow it. MCP holds the same
invariant on its own side — an `exec` token sees and can call the entire catalog, and
the read/write/exec ladder is the only thing that narrows it (`lib/mcp/global-tools.test.ts`).

Four reasons, and the third is the one that settles it:

1. **The lock is already there and it is better.** Every `mutate` tool parks on a
   per-call approval card, under a server-side path jail. A per-agent grant list is
   a second lock on a door that asks for a key every single time.
2. **It has never been a security boundary.** `lib/host/*` is. The approval gate is
   an additional *human* layer, which `use-host-commands.ts` already says in a
   comment.
3. **A per-agent tool array would cost real money.** The tools block sits *before*
   `system` in the cached prefix, and `app/api/assistant/route.ts` marks the system
   block `cache_control: ephemeral`. Forking the tool array per agent means a cold
   prompt cache on every agent switch — a BYOK bill for a feature that grants
   nothing.
4. **It makes an impossible state impossible.** With one tool set, a thread whose
   history holds `tool_use` for a tool "the new agent lacks" cannot occur.

**Reaffirmed 2026-08-20** when MCP gained global project/skill discovery: capability
scoping stayed deleted on both surfaces, and the removed MSO image generation was NOT
replaced by a per-agent toggle.

**Extended 2026-08-21 for project function calling:** project-specific function names
remain DATA, never additions/removals to the model tool array. MCP exposes the stable
`project_capabilities` + `project_function_call` pair; a project may opt in with
`.mso/functions.json`. Alfa keeps its existing stable host catalog and can use project
skills/files + approved `exec.run`; no project switch changes its cached tool prefix. **Done 2026-07-30.** The tool picker, the "Generalist / Curated — by skill" switch,
the per-agent Skills grant list and every string that counted tools per agent are
gone; `toolsForAgent()` went with them. `agent.allTools` and `agent.skills` remain on
the type because they are persisted and `store-migration.test.ts` covers them — they
are inert data now, not a grant. A release-gate audit caught this still shipping: a
preset agent rendered "Ops · 2 skills · 11 tools" while all 18 were sent, so someone
curating a System-only agent was handing the model `fs.read` over their whole read
jail and believing otherwise.

## Known gaps — stated, not hidden

1. **`/api/skills` is uncached**, `force-dynamic`, and now walks the global roots PLUS
   every project's skill roots on each call. Every cap is enforced and reported, so
   the worst case is bounded. Alfa Cockpit therefore lazy-loads Host Skills only when
   the cockpit opens; a TTL cache remains the obvious next optimization.

### Closed

- ~~Playbook starter prompts were dead data~~ — `Skill.starters` now feed the chat empty-state quick actions, deduplicated and bounded.
- ~~Browser automations only narrated steps~~ — Run now sends the ordered recipe through Alfa's normal host-tool loop; reads execute and mutations keep the same approval cards.
- ~~`Skill` and host `SKILL.md` both appeared as “Skills”~~ — the browser-local product surface now says **Playbooks**; persisted `alfa.skills` remains compatible.
- ~~`@agent` is cosmetic~~ — the store is module-level and a pick carries
  `MentionItem.onPick`, which switches the active agent. Verified on a phone:
  picking `@Ops` writes `alfa.activeAgent`.
- ~~The persona is a fake user turn~~ — it is `composeSystem()`, per request.
