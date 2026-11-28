# MCP security QA cleanup: the audit-schema claim now matches its test

Date: 2026-11-28
Scope: closing the two items left open by
[`2026-11-27-mcp-telemetry-redaction.md`](./2026-11-27-mcp-telemetry-redaction.md).
No production behaviour changes; one test was replaced and two archived
findings were re-checked against current code.

## Starting point

The watchdog reported thread `MSO · QA kontrak keamanan MCP` as failed. Its
worktree (`qa/mcp-guards-20261126`) died at item 10 with
`Internal error: OpenCode server is unavailable` before producing findings. The
retry run found the real defect (both telemetry sinks wrote credential values
verbatim) and that fix is on `main` as `1fbbe4b5` (#381). Two items were
explicitly left un-fixed and are closed here.

## 1. `audit-schema.test.ts` asserted on benign input only

The test was named "never persists a plaintext-credential-looking pattern in any
field", but it wrote `ls -la` and `/home/user/notes.md` and then asserted a
keyword regex on that output. It could never fail on a real leak, and its
`/bearer\s+/i` pattern would now false-fail on a correctly redacted line
(`Bearer [redacted]`).

Replaced with a test that writes a real credential in `target`, `detail` **and**
`meta`, then asserts the exact secret value is absent and `[redacted]` is
present, while ordinary path text survives. Assert on values, not on keyword
shapes.

## 2. The archived browser fill/type P2 no longer has a code path

`docs/AUDIT-2026-06-11.md` P2 said `lib/agent/server.ts:52-54` wrote passwords
typed into third-party sites to the audit trail in cleartext. Current
`lib/agent/server.ts` is 73 lines of route-role policy; it has no browser code.
The only audit writer in the browser family is
`lib/camoufox/http.ts:46`, which records `action: "camoufox.power"`,
`target: "camoufox-vnc.service"`, `detail: <start|stop>`. Keystrokes reach noVNC
over the viewer transport and are never logged, so there is nothing to redact.
The audit file is an archived point-in-time document and stays as-is by its own
header; the finding is moot rather than unfixed.

The same document's P2 about `OS_AGENT_TOKEN` ("documented as browser-only but
unlocks the entire host API") is likewise already gone: the variable now
appears only in `lib/host/child-env.ts` and its test, as a name to scrub from
child environments. No reader remains, so it can no longer unlock anything.

## Verification

```bash
VITEST_MAX_WORKERS=2 npx vitest run lib/host/audit-schema.test.ts
# 1 file / 2 tests passed
VITEST_MAX_WORKERS=2 npx vitest run lib/security lib/host
# 91 files / 676 tests passed
VITEST_MAX_WORKERS=2 npx vitest run lib/mcp lib/capabilities lib/tenancy
# 104 files / 678 tests passed
npx tsc --noEmit                                   # clean
npx eslint lib/host/audit-schema.test.ts --max-warnings=0
node scripts/check-architecture.mjs                # healthy within ratchets
node scripts/check-docs.mjs                        # current
VITEST_MAX_WORKERS=2 bun run gate:smart            # 904 files / 5890 tests, audit clean
```

## Still open

- `docs/AUDIT-2026-06-11.md` P3 "no HSTS at app layer (set at the TLS proxy and
  document)": still true. `ops/traefik/mso-ui.yml` sets no STS header and no doc
  states where it is expected. Needs either the middleware in the TLS router or
  one sentence in `docs/GATEWAY.md`.
- `node_modules` in this worktree is a symlink to the canonical checkout's
  `node_modules` (the worktree shipped without dependencies; the lockfile is
  identical).
