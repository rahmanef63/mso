# MCP security QA: telemetry sinks carried credentials verbatim

Date: 2026-11-27
Scope: defensive local QA of MCP operation safeguards, continued from the
interrupted `qa/mcp-guards-20261126` thread.

## Starting point

The prior run stopped at `Internal error: OpenCode server is unavailable` before
it had produced any findings. No code had been changed. This run repeated the
safeguard survey on current `main` and found one real defect.

## What passed (behaviour already correct)

Verified by execution, not by reading declarations:

- **Scope ladder, fail-closed.** Probed every refused combination (65 write+exec
  tools at `read`, 26 exec tools at `write`): each returns an `isError` result
  naming the required scope, never a protocol error, and each writes
  `mcp.denied` with the exact tool name and `detail: scope <held> < <needed>`.
- **`tools/list` = `tools/call`.** Listing filtered exactly by tier at all three
  scopes; no tool lists where it cannot be called.
- **Allowlist and argument constraints.** A tool outside the token allowlist is
  refused at exec scope and audited as `mcp.denied / token tool allowlist`. An
  argument constraint rejects both out-of-list strings and non-string values.
  A hidden tool name is refused identically to an unknown one.
- **`read_pipeline` cannot escalate.** All 65 write/exec tools, unknown names,
  nested pipelines, and the excluded tools are refused as children; the child
  context is forced to `read` even when the parent holds `exec`; a child
  `workflow_id` is rejected.
- **Filesystem isolation.** `withIsolatedFilesystem` pins the workspace by fd and
  revalidates `/proc/self/fd` before each path check; read grants expire with the
  call. Existing suites (`fs-isolation`, `fs-lazy-workspace`,
  `workflow-workspace-guard`, `workflow-filesystem`, `workflow-source-isolation`,
  `session-workflow-isolation`) all pass.

## What failed (the defect)

Both persisted telemetry sinks wrote credential-shaped values verbatim.

1. `lib/host/audit.ts` had **no redaction at all** on `target`, `detail` or `meta`.
   `exec.run` records the whole command line, so a command containing a token
   put that token in `~/.mso/audit.log` in cleartext. `audit-schema.test.ts`
   claimed the trail "NEVER smuggles plaintext credentials", but it only wrote
   benign values and asserted on those, so the claim was untested.
2. `lib/capabilities/activity.ts` (the MCP activity stream, which also feeds
   `activityTarget`) used a hand-rolled pattern list that missed `sk-…`, bare
   `Bearer …`, JWTs, Slack `xoxb-`, and Google `AIza…`. It also diverged from the
   repository's own `redactText`.
3. `lib/security/redact-text.ts` itself did not cover Google API keys or GitLab
   `glpat-` tokens.

This contradicted `docs/MCP.md` ("bearer values … are never stored") and
`docs/AGENT-SECURITY.md` ("cannot leak through normal output, logs, artifacts").

## Fix

One redactor for every telemetry sink instead of per-sink pattern lists:

- `lib/host/audit.ts` redacts `target` and `detail` through `trunc`, and string
  values in `meta` through `clampMeta`. Truncation still applies after
  redaction, so the byte bounds are unchanged.
- `lib/capabilities/activity.ts` deletes its private pattern list and delegates
  to `redactText`, keeping only the control-character strip and the opaque-id
  rule that are specific to activity rows.
- `lib/security/redact-text.ts` adds the Google `AIza[0-9A-Za-z_-]{35}` and GitLab
  `glpat-[A-Za-z0-9_-]{20,}` shapes.

Verified both directions: ordinary command text (`bun run verify`, npm/pip/git
output) is unchanged, so the operator still reads what actually ran.

## Verification

```bash
VITEST_MAX_WORKERS=1 npx vitest run lib/security/telemetry-sinks.test.ts
# 1 file / 11 tests passed

VITEST_MAX_WORKERS=2 npx vitest run lib/host lib/security
# 91 files / 676 tests passed

VITEST_MAX_WORKERS=2 npx vitest run lib/mcp lib/capabilities lib/tenancy
# 104 files / 678 tests passed

node scripts/check-architecture.mjs     # healthy within ratchets
npx tsc --noEmit                        # clean
npx eslint <changed files> --max-warnings=0

VITEST_MAX_WORKERS=2 bun run gate:smart
# 904 files / 5889 tests passed; dependency audit clean; smart-gate passed (mode=full)
```

`gate:smart` at default concurrency timed out in three gateway/service suites
(`mso-gateway-state`, `mso-gateway-web`, `mso-service-update`), each with a
15000 ms test timeout. All three pass serially and under
`VITEST_MAX_WORKERS=1`; this is the known shared-host load pattern, not a
regression from this change.

New regression test: `lib/security/telemetry-sinks.test.ts` writes realistic
synthetic credential shapes through both sinks and asserts none reach disk while
plain command text survives.

## Remaining work (not fixed here)

- The `audit-schema.test.ts` case still only asserts on benign values. The new
  `telemetry-sinks.test.ts` covers the real case; folding the two would remove
  the false-comfort wording in the older test.
- `docs/AUDIT-2026-06-11.md` P2 "browser fill/type audit lines persist typed
  text" concerns the browser agent path in `lib/agent/server.ts`, which does not
  route through `lib/host/audit.ts`. It needs its own fix and was out of scope
  for this MCP QA pass.
