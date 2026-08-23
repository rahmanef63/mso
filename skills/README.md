# MSO skill catalog

MSO exposes markdown playbooks from several roots — **global roots and the per-project roots of every project on the box** — but discovery is **not** the same as trust.

## Trust and precedence

Highest precedence wins when two roots contain the same catalog id:

1. `~/.mso/skills` — **local** operator override. This is the only host root that may intentionally replace an MSO skill.
2. `<MSO_ROOT>/claude-skills` — **official** MSO skills. These are always cataloged directly from the repo; Claude does not need to be installed and no symlink is required.
3. `<MSO_ROOT>/skills` — bundled third-party skills. A ClawHub skill is **verified** only while its current `SKILL.md` SHA-256 matches `.clawhub/origin.json`; otherwise it is **untrusted**.
4. Generic HOME discovery roots (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, OpenClaw roots) — **untrusted** by default and cannot shadow the three roots above.
5. **Per-project roots**, inside every project across every configured container: `.mso/skills`, then `.claude/skills`, `.hermes/skills`, `.agents/skills`, `.codex/skills`. Ranked below every global root.

The assistant lists/loads only `official`, `verified`, and `local` instructions by default. Untrusted skills remain visible in the catalog for inspection, but their instructions are not fed directly to the model. Review one as a normal file, then copy/move the approved skill into `~/.mso/skills` if you intentionally want to trust it.

## Ids: a project skill cannot shadow anything

A global skill is addressed by its bare **name**. A project is `<rootId>/<name>` and a
project skill is `<rootId>/<project>/<name>`, where `rootId` is **128 bits** (32 hex
characters) of sha256 over the canonical container path — it was 32 bits, and a review
found a real collision between two `/tmp` roots. Nothing dedupes on the hash either: the
internal key is the full canonical path. That makes ids **globally unique**, which the bare
`<project>/<name>` form was not: two *different configured roots* may each hold a
`widget` shipping `deploy`, and both stay visible, readable and searchable instead of
one silently winning. The derived `projects/` container gets its own `rootId` for the
same reason, so `~/widget` and `~/projects/widget` cannot collide either.

`skills_read` / `skills.read` take the **exact id**. A bare name is accepted only when
it is unambiguous; when several projects ship it the call is **refused** and lists the
exact ids, because returning one project's instructions under another's name is exactly
the failure this id scheme exists to prevent.

## Project skills earn `local` trust; they do not inherit it

Living in a project grants nothing by itself. A project skill is promoted to `local`
only when all three hold:

1. **Containment** — the skill directory realpaths back inside its project, so a
   `.claude/skills -> /tmp/attacker` symlink is *discovered*, not followed.
2. **Ownership** — the skill directory and its `SKILL.md` belong to the uid MSO runs as.
3. **Shape** — `SKILL.md` is a regular file, not a symlink to somewhere else. The reader
   is `O_NOFOLLOW` at that exact path, so a `SKILL.md -> other/SKILL.md` link is not an
   untrusted skill, it is not a skill at all and is dropped from the catalog.

Anything else is cataloged `untrusted`. The generic HOME agent roots keep their existing
untrusted behaviour; this promotion applies to project-scoped roots only.

Scans are bounded and say so. Caps: 12 containers, 400 entries per container, 400
projects, 60 projects scanned for skills, 200 entries per skill root, 300 project
skills, a 256 KiB `SKILL.md`, and a 4-second wall clock per walk. Directory iteration
uses `opendir` and stops at the cap rather than reading the whole listing first, **every
dirent counts against the cap whether or not it is accepted**, the deadline is enforced
through the per-entry stat/read work, the 300-skill total is enforced inside the
candidate loop, and every file read goes through one byte-capped `O_NOFOLLOW` reader that
checks the cap against `fstat` before any bytes move.

Every discovery response carries a **scan report**. `truncated:false` means "this is all
of it"; hitting a cap sets `truncated:true`, names the reason, and includes
`continuation` — pending roots, the exact interrupted position and an opaque `cursor` to
pass back. Resumption is lossless: each dirent is validated as it streams and the position
advances only after that entry is fully handled, so a cap or deadline re-reads the entry
it stopped on instead of skipping it. A partially consumed project is resumed, never
marked done. Do not conclude a skill is absent from a truncated scan.

## Contract

Each skill is a directory containing `SKILL.md` with YAML frontmatter (`name`, `description`). MSO returns catalog metadata including `id`, `source`, `trust`, its `project` when it has one, and verified provenance when available.

Skill roots are intentionally read outside the normal filesystem jail, because agent skill registries may live outside `OS_FS_READ_ROOTS`. The reader therefore opens only a file named exactly `SKILL.md` after `realpath`; a symlink such as `SKILL.md -> ~/.ssh/config` is refused. Root trust/precedence handles the remaining instruction-supply-chain risk.

## Curated installable market

The discovery catalog above is not an invitation to trust arbitrary internet instructions.
MSO therefore has a separate **reviewed install market** under `skill-market/`. It is
driven from the CLI:

```bash
mso skills available
mso skills info ponytail
mso skills install ponytail caveman rtk -y
mso skills remove ponytail -y
```

A market entry is committed with an exact `SKILL.md` hash, source/version/license metadata
and review status. `scripts/skill-market.mjs` verifies that hash and the frontmatter name
before installing to the explicit operator-trust root `~/.mso/skills`. Installed entries
carry `.mso-market.json` provenance. A same-name local modification is never overwritten by
`-y`; `--force` is required. Removal refuses skills that do not carry MSO's market marker.

Current reviewed entries are Ponytail, Caveman, and `rtk`. Ponytail/Caveman are pinned
third-party snapshots. `rtk` is an MSO-authored safe wrapper around the RTK usage pattern:
it never auto-runs a remote installer or edits shell startup/hooks. Installing the RTK
binary remains a separate operator decision.

This market is intentionally curated rather than a pass-through search of ClawHub. A future
entry should be reviewed, pinned and committed before it can become `local` trusted with one
install command.

## Bundled third-party skill

`camoufox-browse` comes from ClawHub (`zenaufa`, installed version 1.0.7). Its `.clawhub/origin.json` records the artifact and skill hashes. Do not edit its `SKILL.md` in place: a modification intentionally invalidates verification. Put MSO-specific policy in an official wrapper skill instead.

## Semantic search and learned recipes

The catalog — global roots and every project's roots together — is indexed with the
live MCP tool schemas and successful workflow recipes, and each skill hit carries its
project. `workflow_start` searches the same unified catalog, so a workflow named against
one project still finds the relevant skill in another.
`skills_search` / `skills.search` and `GET /api/skills?q=...` use
the local `mso-local-hybrid-v1` encoder, so searches work across English, Indonesian
and minor typos without a cloud embedding API. Untrusted skill instructions remain
excluded by default.

A multi-step MCP client can bracket work with `workflow_start` and
`workflow_finish`. MSO records only redacted terminal tool steps, explicitly allowlisted scalar
arguments, timings and the verified outcome in `~/.mso/skill-memory.json`, merges semantically equivalent
intents, and retains the fastest successful sequence as a future recipe. Failed
attempts remain evidence but never replace a successful path. Recipes are ranked
with trust, semantic relevance, observed success rate, speed and current tool
availability; they are suggestions, not permission to skip scope or approval gates.
