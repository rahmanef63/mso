# MCP — drive this VPS from ChatGPT, Claude.ai or Cursor

> **Current deep reference.** For ChatGPT specifically, use
> [`CHATGPT-PLUGIN.md`](./CHATGPT-PLUGIN.md) for current custom-MCP-app terminology,
> setup values and diagrams. This file owns protocol, tool, discovery, workflow and
> security internals.

> For implementation or repair work, follow
> [`MCP-FEATURE-IMPLEMENTATION.md`](./MCP-FEATURE-IMPLEMENTATION.md): resolve the live
> target, map patterns and limits, reverse-engineer a working analogue, change one reversible
> layer, then prove tool/skill parity and runtime behavior.

mso ships an MCP server so an AI client can call the same host operations the web
UI does: list and read files, write them, check CPU/memory/disk, list processes and
managed apps, and — if you grant it — run shell commands.

It is **off by default**. While `OS_MCP_ENABLED` is unset, `/mcp` and both OAuth
discovery documents return 404. There is no MCP surface at all, not an
unauthenticated one.

## Turn it on

```bash
# .env.local
OS_MCP_ENABLED=1
OS_MCP_MAX_SCOPE=read    # read | write | exec; default ceiling is exec
```

After changing deployment environment, use the normal MSO update/rebuild path (Settings →
About or `mso update run --rebuild`). A Git push or editing `.env.local` does not change the
running service by itself.

## Connect an MCP client

The stable server contract is the remote HTTPS endpoint plus OAuth discovery:

| Purpose | Path |
|---|---|
| MCP | `/mcp` |
| authorize | `/oauth/authorize` |
| token | `/oauth/token` |
| dynamic registration | `/oauth/register` |
| authorization metadata | `/.well-known/oauth-authorization-server` |
| protected-resource metadata | `/.well-known/oauth-protected-resource` |

MSO supports OAuth 2.1-style authorization-code flow with PKCE S256 and public clients
(token endpoint auth `none`). The current authorization metadata advertises only
`authorization_code`; there is no refresh-token grant. The authorization page is a normal
signed-in MSO page: an approved human browser session converts into a scoped MCP bearer; the
consent page is not a second login mechanism. Expired/revoked bearers therefore require a
new authorization flow.

For ChatGPT, the current product surface is a **custom MCP app/connector in Developer
Mode**. Its UI and plan availability are owned by OpenAI and can change during the beta, so
this deep reference does not freeze ChatGPT menu labels. Use
[`CHATGPT-PLUGIN.md`](./CHATGPT-PLUGIN.md) for the current field mapping, OAuth sequence,
tool-snapshot refresh and troubleshooting.

Clients that support RFC 7591 Dynamic Client Registration can register through
`/oauth/register`. ChatGPT can also use the predefined public `chatgpt-mso` client without a
secret.

A 404 from either well-known discovery document normally means `OS_MCP_ENABLED=1` is not
active in the **running** process (demo mode also forces MCP off).

## The three scopes

Picked per token, on the consent screen, capped by `OS_MCP_MAX_SCOPE`. The highest allowed tier is preselected (`exec` on a default install); lower it before Allow when a client does not need full host access.

| Scope | Tools |
|---|---|
| `read` | `fs_list` `fs_read` `fs_search` `fs_usage` `sys_stats` `sys_processes` `apps_list` `apps_logs` `projects_list` `project_capabilities` `skills_list` `skills_read` `skills_search` `screen_capture` `browser_status` `exec_job_status` |
| `write` | + `workflow_start` `workflow_cancel` `workflow_finish` `fs_write` `fs_upload_file` `fs_mkdir` `fs_move` `fs_copy` `fs_delete` `apps_power` |
| `exec` | + `project_function_call` `exec_run` `exec_job_start` `exec_job_cancel` `browser_power` |

Alfa — the in-app assistant — has the same host capabilities under dot.case names,
and `lib/mcp/parity.test.ts` fails if one surface gains a tool the other lacks
without a written reason. `skills_search` maps to Alfa's `skills.search`.
`screen_capture`, `projects_list`, `project_capabilities`, `project_function_call`, `fs_upload_file`, `workflow_start`, `workflow_cancel` and
`workflow_finish` are explicitly MCP-only: the external connector needs visual proof,
an explicit project enumeration and an actor-scoped task boundary, while Alfa already
runs inside the rendered shell, has the Files window and owns an in-app run boundary.
`skills_list` and `skills_read` now exist on BOTH surfaces — capability discovery is
global by design, and withholding it from the connector was scoping nobody chose. The
two catalogs stay separate on purpose (different transport and guard) but may not
drift by accident.

**These tool names are also a cross-repo contract.** `rahmanef63/connectors-gateway`
registered mso as a connector on 2026-08-17 and pins 15 of these names as strings; a
rename here breaks it with no error in either repo, and `parity.test.ts` does not cover
that axis. See [`CONNECTORS-GATEWAY-INTEGRATION.md`](./CONNECTORS-GATEWAY-INTEGRATION.md)
before renaming or removing a tool.

The tiering is about blast radius, not about which layer the call lands in.
`apps_logs` reads a daemon's journal, so "why is hermes down?" is answerable from
a `read` token — the same question through `exec_run` would need a full shell.
`apps_power` is four verbs (start, stop, restart, backup) against known units, so
restarting a daemon does not require handing one over either.

`tools/list` is filtered by the token's scope, and `tools/call` re-checks it — a
client that calls a tool it was never shown still gets refused.

**The scope ladder is the ONLY thing that narrows the catalog.** An `exec` token sees
and can call every public tool; `read` and `write` are strict prefixes of it. There is
no per-project, per-agent, per-workflow or per-client tool filter, and there must not
be one — which tools EXIST is not a security control here, the ladder plus `lib/host`'s
path jail and command filter are. Every operational tool carries an OPTIONAL
`workflow_id`: it correlates steps, it never gates a capability. `lib/mcp/global-tools.test.ts`
pins all of this, including that a token's visible list matches its callable set exactly.

## Toolset version, hash and action refresh

The catalog has a stable server version plus a schema-derived toolset signature. It is returned by public `GET /mcp`, MCP `initialize`, scoped `tools/list`, and the authenticated Settings → MCP endpoint. The signature changes when a name, description, input schema, scope, annotation or per-operation limit changes—not only when the tool count changes.

Settings → MCP shows the current version/hash/count and stores a browser-local acknowledgement when the operator marks ChatGPT refreshed. A later signature change becomes an explicit stale-snapshot warning. This does not mutate ChatGPT remotely; it makes the required refresh visible instead of relying on memory.

<!-- mcp-toolset: server=1.6.0 version=2026.08.28.1 tools=31 read=16 write=10 exec=5 -->

Current catalog: **31 tools** (16 read, 10 write, 5 exec), server `1.6.0` / toolset
`2026.08.28.1`. `project_capabilities` and `project_function_call` add one stable
project-automation seam without creating a dynamic MCP tool catalog; existing tool names
remain unchanged.

## Opt-in project MCP/function capabilities

MSO itself stays generic. A project opts into extra automation by placing files inside
its own validated project directory:

- `.mcp.json` — MSO reports only that the MCP config exists. It never returns the file
  contents because MCP configs commonly contain env/credential wiring. MSO does not
  automatically connect to arbitrary project MCP servers.
- `.mso/functions.json` — a bounded manifest of project-owned functions.

The manifest is versioned and intentionally uses **fixed argv**, not a shell template:

```json
{
  "version": 1,
  "functions": [{
    "name": "asset_status",
    "description": "Read the project's asset status.",
    "inputSchema": {
      "type": "object",
      "properties": { "id": { "type": "string" } },
      "required": ["id"],
      "additionalProperties": false
    },
    "command": ["bun", "run", "project:call", "--", "asset_status"]
  }]
}
```

`project_capabilities` is read-scope and returns only public name/description/schema
metadata. `project_function_call` is always **exec-scope**, even for a function named
"read": it executes project code. MSO spawns the manifest argv directly with no shell
and sends the model/caller's JSON object on stdin; caller values are never interpolated
into command arguments. The child receives the existing scrubbed environment, so MSO
credentials and provider tokens are not inherited. Projects without either file gain no
new behavior.

This shape preserves the global-tool invariant: MCP clients always see the same two MSO
tool names, while the project-specific function names are data returned after project
resolution. It also means adding a function to a project does not change MSO's toolset
hash or force a cold prompt-cache prefix.

For project callbacks that must enter a managed app (for example a signed webhook into a
loopback-only agent), deployments may opt into `OS_PROJECT_INGRESS_ROUTES`. It defaults
to empty. Routes are exact POST paths, max eight, loopback-only targets, and currently
require HMAC-V2-shaped JSON headers; the loopback service remains responsible for real
cryptographic verification.

## Safe text inspection and overwrite

`fs_read` returns `content`, UTF-8 byte count and SHA-256. For an existing file, pass that digest as `fs_write.expected_sha256`; the write is refused if another process changed the file since inspection. Omitting it preserves create/legacy overwrite behaviour. Workflow memory stores the path, never the content or digest.

## Global project and skill discovery

MSO drives **all** of the owner's projects, not the one it happens to live in.

### Which directories count, and why a symlink never does

Each `OS_FS_READ_ROOTS` entry is canonicalized ONCE into an **authorized root**. A
container — a directory that holds projects — is an authorized root, plus its
`projects/` child *only when* that child is a real, non-symlink directory whose
realpath stays inside that same root. A symlinked `projects/` is refused outright, even
when it currently points somewhere legal: accepting it is a TOCTOU bet, because the link
can be repointed between the check and the walk. `/` is never a container — "/" as a read
root means browse-anywhere, not "every top-level system directory is a project".

**One validator decides, everywhere** (`lib/host/project-candidate.ts`). Enumeration and
*every* `resolveProjectHint` strategy — path, exact name, alias, package, fuzzy — go
through it, so a hint can never reach something `projects_list` refuses to show. It
rejects, in order: a hidden component; a symlinked component (target legal or not — a
link is not a child of this container); an escape from the container or from every
authorized root; a credential path; and a directory not owned by the uid MSO runs as.
Ownership is checked **before** any metadata read, so a directory another user controls
never reaches the `package.json` or `.git` readers at all. A path hint is validated
component by component from the container down, because canonicalizing first and checking
afterwards is exactly what let a symlinked intermediate through.

A caller-supplied `rootHint` gets the same treatment: a symlinked root is refused rather
than canonicalized into something the caller never named, and **any** dot-prefixed
component below the authorized root is refused — measured relative to that root, so a
checkout legitimately living under `~/.claude/worktrees` still works while nothing may
hide beneath it. It is authorized against *every* configured read root rather than the
scan-capped subset: naming a root never widens the jail, but the jail must not shrink
because twelve other roots were configured ahead of it.

**An exact `<rootId>/<project-name>` is resolved first**, before alias, package or fuzzy
matching. The `rootId` maps to exactly one container across every configured root, the
project name is then checked by the shared validator, and an unknown `rootId` is refused
outright. Falling through to fuzzy matching is what made two same-named projects
unaddressable: asking for the second one's id returned the first.

### Bounds, and telling the truth about them

Every scan is bounded: 12 containers, 400 entries read per container, 400 projects,
60 projects scanned for skills, 200 entries per skill root, 300 project skills, and a
4-second wall clock on each of the two walks. Directory iteration uses `opendir` and
stops at the cap rather than materializing the whole listing first, and **every dirent
counts against the cap whether or not it is accepted** — counting only the entries we
kept meant a container of a million regular files still cost a million iterations before
the "400 entry" cap was reached. The deadline is enforced *through* the per-entry
`lstat`/`realpath`/metadata work too, which is where a slow or networked filesystem
actually spends its time. The overall project-skill cap is enforced inside the candidate
loop, not merely before each root, so one root cannot carry the total past it.

Every metadata read goes through one byte-capped, `O_NOFOLLOW` reader
(`lib/host/bounded-read.ts`): the cap is checked against `fstat` *before* any bytes move,
so an oversized `package.json`, `SKILL.md` or `packed-refs` costs one stat, not its size.

`projects_list`, `skills_list`, `skills_search` and `workflow_start` all return a
**scan report**. `truncated:false` means "this is all of it"; hitting any cap sets
`truncated:true` and names the reason (`maxRoots`, `maxEntriesPerRoot:<path>`,
`maxProjects`, `maxProjectSkills`, `deadline`), alongside `scannedRoots`, `skippedRoots`
and a count of entries rejected by the containment/ownership checks. **Do not conclude a
project or skill is absent from a truncated scan** — the tool descriptions say so too.

**Every cap is losslessly resumable.** Both walks are a single streaming pass: each dirent
is validated as it arrives and the recorded position advances **only after** that entry is
fully processed, so a cap or deadline that trips mid-entry re-reads it rather than skipping
it. A truncated report carries `scan.continuation` with the pending roots and an opaque
`cursor` to pass back.

The project position is `(rootIndex, containerIndex, entriesConsumed)`, where `rootIndex`
indexes the **uncapped** configured-root list — that offset is what lets `maxRoots` advance
at all; without it every call rebuilt the same capped prefix and a 13th configured root was
unreachable forever. The skill cursor records the roots that finished *cleanly*, the
projects whose every root finished cleanly, and the exact dirent position inside the one
root that was interrupted; a partially consumed project is re-listed and resumed, never
marked done.

Cursors are raw readdir stream positions (`cursorSemantics: "readdir-stream-position"`)
and are valid while the directories are unchanged — name-ordered cursors would require
visiting every dirent to find the next N names, which is the unbounded walk the entry cap
exists to prevent. Rows inside a returned page are sorted for presentation; *which* rows
land in a truncated page is stream order.

There are deliberately **two** paginations and a client needs both: `hasMore`/`nextOffset`
walks the rows of one scan, `scan.continuation.cursor` resumes the scan itself past a cap.

### Ids, so nothing shadows anything

A global skill is addressed by bare name. A project is `<rootId>/<name>` and a project
skill is `<rootId>/<project>/<name>`, where `rootId` is **128 bits** (32 hex characters)
of sha256 over the canonical container path. It was 32 bits, and a review found a real
collision — `/tmp/mso-root-50323` and `/tmp/mso-root-125549` both hashed to `51e156ef` —
which would have merged two roots' same-named projects back into one row. Belt and
braces, nothing dedupes on the hash: the internal key is the full canonical path, so even
a collision cannot merge two containers. That exact pair is an end-to-end regression
(`lib/mcp/collision-e2e.test.ts`) asserting that `projects_list`, `skills_list`,
`skills_read`, `skills_search` and `workflow_start` each return the **second** project
when handed the second id. That makes ids **globally unique**: two configured roots may each hold a
`widget` shipping `deploy`, and both stay visible, readable and searchable. The derived
`projects/` container gets its own `rootId` for the same reason, so `~/widget` and
`~/projects/widget` cannot collide either. Within one project, `.mso/skills` outranks the
agent-tool roots; every project root ranks below every global root, so an operator or
official skill can never be displaced.

`skills_read` takes the exact id. A bare name is accepted only when it is unambiguous —
when several projects ship it, the call is **refused** and lists the exact ids rather
than handing back another project's instructions under the name you asked for.
`skills_list`'s `project` filter accepts an exact `projectId`, an absolute path, or a
bare name; a bare name matching several roots keeps them all and reports the candidates
in `ambiguousProjects`.

`resolveProjectHint` — behind `workflow_start`'s `project` and `fs_search` — searches
the same containers, deterministically and exact-before-fuzzy: an absolute/`~` path wins
outright, then an exact directory name or known alias probed container by container,
then one bounded scan scoring exact package names above substrings. The exact-name probe
refuses exactly what enumeration refuses — a symlinked entry (whether or not its target
is legal) and a hidden directory. An explicit `rootHint` runs **every** strategy inside
that root, including package and fuzzy matching, even when the global container list is
already at its cap; a path hint may not leave it.

### Project skill trust is earned, never assumed

`skills_list` merges the global roots with the per-project roots of every project:
`.mso/skills`, `.claude/skills`, `.hermes/skills`, `.agents/skills`, `.codex/skills`.
A project skill becomes `local` only when all three hold: the skill directory realpaths
back *inside* its project; the directory and its `SKILL.md` are owned by MSO's uid; and
`SKILL.md` is a regular file, not a symlink. Otherwise it is cataloged `untrusted` —
metadata visible, instructions withheld until the operator reviews it and moves it into
`~/.mso/skills`. The generic HOME agent roots keep their existing untrusted behaviour.

The `SKILL.md` reader is `O_NOFOLLOW` **at the supplied path**, not at a canonicalized
substitute. It previously realpath'd first and opened the *target*, so a
`SKILL.md -> other/SKILL.md` symlink passed the basename check and was read — the nofollow
promise enforced against a path the caller never gave. A symlinked `SKILL.md` is now not a
skill at all: it is dropped from the catalog rather than listed as untrusted. Parent
containment is validated separately, precisely so the final component is never dragged
through `realpath` again.

`workflow_start` and `skills_search` search this unified catalog; every skill hit carries
its `project`, and the bootstrap carries a `discovery.complete` flag plus a
`[Discovery] partial scan` trace line when the catalog was truncated.

## Semantic skill search and learned workflows

MSO does not need to rediscover the same safe procedure on every conversation.
For a multi-step task, `workflow_start` is the **single bootstrap call**. It:

1. creates a unique exact-id run boundary;
2. searches trusted `SKILL.md` instructions, the current scoped MCP catalog and learned recipes;
3. resolves project paths and aliases such as `os-vps` → `mso`;
4. returns toolset version/hash/count, package metadata and bounded Git context;
5. recommends the closest successful recipe and execution policy.

Every operational tool advertises an optional `workflow_id`. Carry the exact id returned
by `workflow_start` on each step in that run. Multiple conversations may hold isolated
workflows in parallel on the same token. A call that omits the id is deliberately
standalone, and an unknown id is refused before the operation runs.

On approval, MSO returns the validated PKCE callback to the consent client, which uses
a top-level `location.replace()` rather than a nested Server Action redirect. This avoids
the confusing state where ChatGPT has already exchanged the code but the MSO tab remains
open. A setup started from ChatGPT Settings may still return to the app setup/tool-scan
surface rather than to the exact conversation that was open.

Use `skills_search` alone for capability research or an unfamiliar single-step task;
do not call it immediately before `workflow_start` for the same work. `workflow_finish`
requires the exact returned id and, after independent verification, records the redacted
sequence and merges semantically equivalent intents. `workflow_cancel` also requires the
exact id and abandons only that run without creating a recipe. A faster successful run
replaces the best path; a failed run remains evidence but never replaces a successful
recipe.

The index uses `mso-local-hybrid-v1`: a deterministic, local 384-dimensional
feature-hashed vector over words, bilingual aliases, bigrams and character n-grams,
combined with lexical overlap. It requires no API key, network call, model download
or token budget. This is a small local semantic router for MSO's skill/tool catalog,
not a general-purpose cloud embedding model. A future encoder can re-index recipes
because every saved vector carries its version.

Connected clients receive the bootstrap, terminal-batching, verification and visible-trace policy in MCP `initialize.instructions`:

```text
workflow_start → bounded tools or one scoped terminal batch → verify → workflow_finish
interrupted run → workflow_cancel with the exact workflow id
```

A recipe is guidance, not permission. The connector still checks current tool
availability, token scope, project context and safety constraints before reusing it.
Recipes that reference a missing or renamed tool are marked and ranked down.

From the browser or CLI:

```bash
mso skills list
mso skills read mso
mso skills search "deploy MSO and verify production"
```

The same search is available to Alfa as `skills.search` and through the
session-gated endpoint `GET /api/skills?q=...`.

## Creating a workflow skill

Use the committed template rather than copying an arbitrary `SKILL.md`:

```bash
bun run skill:new -- \
  --name mso-example \
  --description "Route a repeated MSO task through the smallest safe tools and verify the requested outcome." \
  --risk medium \
  --policy inspect-execute-verify \
  --title "Example Workflow"
bun run skill:check
```

The generator reads `templates/mso-skill-flow/SKILL.md.template`, writes only a new
`claude-skills/<name>/SKILL.md`, and refuses to overwrite an existing skill. The
template standardizes trigger boundaries, route selection, visible trace, verification,
rollback, approvals and recipe-memory hygiene. `mso-skill-authoring` is the trusted
playbook for completing and reviewing the generated file.

## Visual progress and secure temporary links

`screen_capture` renders only MSO itself — never an arbitrary URL — and can choose
`macos`, `windows` or `dashboard`. It returns the PNG directly to the MCP client plus
a temporary MSO preview/download URL. The artifact lives outside `public/`, requires
a valid approved-device session, uses an unguessable id, expires after 15 minutes,
is limited to five downloads, sends `Cache-Control: no-store`, and is deleted after
expiry/exhaustion. This provides visual progress without turning a read token into a
general browser or public-file-hosting primitive.

## Removed: provider-backed image generation

`image_generation_status` and `image_generate` were removed on 2026-08-20, along with
`lib/image-generation/`, the `OS_IMAGE_MODEL` / `OS_IMAGE_OUTPUT_ROOT` knobs and the
Codex provider-side `image_generation` built-in. **A GPT client already carries its own
image generation**, and offering a second tool for the same job made the model choose
between them — usually wrong, and the MSO one billed a separate API key. Nothing
replaces it: ask the client to generate the image with its own capability.

Importing the result is unchanged and deliberately preserved: **`fs_upload_file`** takes
one ChatGPT conversation/generated file through `openai/fileParams`, downloads its
temporary OpenAI HTTPS URL immediately, re-validates up to three redirects, caps the file
at **20 MiB**, accepts PNG/WebP/JPEG or generic octet-stream, and writes inside
`OS_FS_WRITE_ROOTS`. Allowed download hosts are OpenAI `*.oaiusercontent.com` content hosts
or the explicitly matched `oaisdmntpr<region>.blob.core.windows.net` storage-account
family—not arbitrary Azure Blob hosts. The result returns path, bytes and SHA-256. An
existing same-name file may be replaced, so the tool is classified as a write/destructive
action. See `CHATGPT-PLUGIN.md` for the end-to-end diagram.

`OS_CODEX_BUILTIN_TOOLS` still exists and still takes an allowlisted list, but its
default is now EMPTY and `image_generation` is no longer an accepted value — naming it
is dropped, not honoured.

## What this does and does not protect

Every tool goes through `lib/host`, so the MCP surface inherits the bounds that
already guard `/api/v1`:

- `OS_FS_READ_ROOTS` / `OS_FS_WRITE_ROOTS`
- the credential denylist — `~/.ssh`, `~/.gnupg`, cloud and AI tokens, and `~/.mso`
  itself, so a read tool cannot exfiltrate the device allowlist, the BYOK key or
  the browser profile's cookies
- realpath escape checks on every path
- the catastrophic-command filter in `lib/host/exec.ts` (`rm -rf /`, fork bombs,
  disk wipes)

The Camoufox viewer URL and its one-time VNC password are deliberately **not**
returned by `browser_status`. That profile holds a live Google session; its
credentials never leave the box through a tool result.

**What it does not protect against, and you should decide with open eyes:**

- A bearer is a standing credential. Anyone who obtains it has your scope until you
  revoke it. Tokens expire after 90 days; that is a backstop, not a control.
- At `exec` scope, that means arbitrary commands on this VPS as you.
- Every tool call and its result goes to the client's provider. At `read` scope
  that is file contents; at `exec` scope it is command output.
- Prompt injection is real here: content the model READS (a file, a log line, a
  web page it was told to fetch) can try to talk it into calling a write or exec
  tool. Scope is the containment — a `read` token cannot be talked into `rm`.

Grant `read` unless you actually need more, and mint a second token when you do.

## Seeing what a token did

MSO keeps two deliberately different records.

### Live MCP activity — operational visibility

Every MCP tool call, including reads, produces correlated `started` and terminal
(`completed`, `failed`, `denied`, `rate_limited`) rows in
`~/.mso/mcp-activity.log`. Workflow rows carry `workflowId`, intent and project, so
Assistant → MCP groups one task into a collapsible sequence instead of unrelated calls.
Each row renders a high-level feature badge/icon such as Skills, Files, Terminal, Git,
Build, Verify or Screenshot, plus status, duration and redacted target. This is an
execution trace, not private chain-of-thought. `fs_write.content`, file bodies, bearer
values and raw tool results are never stored.

View it in **Assistant → MCP** (live polling with pause/resume) or from the CLI:

```bash
mso mcp activity
mso mcp activity 100
```

### Security audit — forensic visibility

State-changing calls also land in the append-only security trail
`~/.mso/audit.log`, with `actor=mcp:<id>` matching Settings → MCP and
`mso mcp list`. The audit records `fs.write`, `fs.mkdir`, `fs.move`, `fs.copy`,
`fs.delete`, `fs.upload`, `exec.run`, `managed-app.action`, `camoufox.power`,
`workflow.start`, `workflow.cancel`, `workflow.finish`, and `mcp.denied`. It is intentionally quieter
than the activity stream so security-relevant lines are not buried by reads.

```bash
mso audit              # newest 50, everything
mso audit 100 exec.    # just command execution
mso audit 50 workflow. # learned workflow boundaries
mso audit 50 mcp.      # scope refusals
jq -c 'select(.actor|startswith("mcp:"))' ~/.mso/audit.log
```

A `read` connector repeatedly reaching for `exec_run` appears as `mcp.denied` and
is the prompt-injection signal worth watching. There is deliberately no MCP tool
for reading the security trail: a compromised token must not be able to check
whether the owner noticed it. The session-gated browser/CLI surfaces can read it.

## Revoking

**mso → Settings → MCP**, or from the CLI:

```bash
mso mcp list
mso mcp revoke <id>
mso mcp revoke all      # panic button
```

Revocation is immediate: the token is re-validated on every single call, so an
in-flight connector stops on its next request.

## Storage

`~/.mso/mcp.json`, mode 0600, is written atomically and holds **sha256 only** for
every authorization code and bearer. The raw value exists in flight and is handed
to the client exactly once. Authorization codes are single-use with a 60-second
TTL and are deleted before token minting.

Learned workflows live separately in `~/.mso/skill-memory.json` (override with
`OS_SKILL_MEMORY_STORE`), also mode 0600 under a 0700 directory and written by
atomic rename. It stores intent/summary, local semantic vectors, tool names, redacted targets and only
explicitly allowlisted scalar arguments, timings and outcomes. It does **not** store `fs_write.content`, raw file
contents, browser credentials, bearer tokens, API keys, or full secret-looking shell
arguments. The v2 store keeps up to 20 isolated active workflows per MCP actor, keyed by exact id; it migrates a live v1 actor workflow on read. Completed memory is bounded to 200 recipes. Each workflow retains at most 300 redacted evidence steps, while the reusable best path is compressed to at most 24 successful steps so exploratory reads and failed attempts are not taught back to the next run.

## Rate limits

Per token: 120 calls/min, 5,000/day. Per IP before auth: 240/min. DCR: 10
registrations/hour/IP. Token exchange: 30/min/IP. All in-memory (process-local,
resets on restart) — enough to blunt a runaway agent, which is the realistic
failure mode for an endpoint whose top scope is a shell.

Those are per TOKEN and say nothing about which tool ran, so each mutating tool
also carries the **per-operation** limit its route already applies, on the SAME
bucket key — MCP and the browser share one allowance rather than getting one each.
`exec_run` 60/min, fs writes 120/min, fs copy/delete 60/min, `apps_power` and
`browser_power` 12/min per app. MCP-native expensive/stateful operations are
stricter: `screen_capture` 10/min, `projects_list` and `skills_list` 30/min,
`skills_read` 60/min, and workflow-memory writes 30/min.

## Layout

```
lib/mcp/pkce.ts           S256 verify, base64url, hashing, redirect_uri rules
lib/mcp/scope.ts          the read/write/exec ladder + the env kill switch
lib/mcp/store.ts          ~/.mso/mcp.json — clients, codes, tokens (hashed)
lib/mcp/tool-kit.ts       McpTool, direct image content and run context
lib/mcp/tools-read.ts      bounded reads + skills_search + screen_capture
lib/mcp/tools-discovery.ts projects_list / skills_list / skills_read — global discovery
lib/mcp/tools-learning.ts  one-call bootstrap + start / cancel / finish
lib/mcp/tools-power.ts     apps_power + browser_power
lib/mcp/toolset.ts         server/toolset version, schema hash and scoped manifest
lib/mcp/tools.ts           fs write tier and the assembled catalog
lib/mcp/activity.ts       workflow-correlated live activity
lib/mcp/dispatch.ts       JSON-RPC, scope checks, metadata, activity + recipe capture
lib/host/projects.ts       project resolution across every container, plus aliases
lib/host/project-roots.ts  every configured project container + bounded enumeration
lib/host/project-meta.ts   symlink-refusing package.json / .git readers
lib/host/guarded-write.ts optimistic SHA-256 file overwrite guard
lib/skills/catalog.ts      global + per-project SKILL.md roots, ids and provenance
lib/skills/project-skills.ts per-project roots and their earned-trust checks
lib/skills/semantic.ts    local hybrid embedding/search primitives
lib/skills/search.ts      unified skill/tool/recipe ranking
lib/skills/memory.ts      migrated multi-run exact-id workflow and recipe store
app/api/skills/route.ts   browser/Alfa list, read and semantic search
app/mcp/route.ts          bearer, rate limits and dispatch
app/oauth/*               authorize (consent) · token · register (DCR)
app/.well-known/*         RFC 9728 + RFC 8414 discovery
```

`/mcp` lives outside `/api` on purpose: `proxy.ts` blocks mutating `/api` that
cannot prove same-origin, and an MCP client is cross-origin by definition. The
CSRF gate is not the control here — the bearer is, and a browser never attaches
one on its own the way it does a cookie.


### Bounded asynchronous execution

`exec_job_start` starts a client/workflow-bound command that may run up to 20 minutes; `exec_job_status` reads its bounded output and final exit state; `exec_job_cancel` stops a still-running job. Use this trio for test/build pipelines instead of wrapping `exec_run` in host-specific background-process plumbing.
