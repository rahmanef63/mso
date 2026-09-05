# Session screenshots and temporary artifacts

MSO owns one private artifact store for durable CLI/MCP sessions. Screenshot producers such as Playwright or Camoufox do not choose usernames, invent public file URLs, or maintain independent session catalogs.

```text
Authenticated session
  -> session path policy
  -> private incoming/ (browser producer)
  -> session_artifact_register (validate, name, hash)
  -> manifest.json + screenshots/ or reports/
  -> session_artifacts (list or image/JSON read)
  -> retention cleanup after inactivity
```

## Path and ownership contract

The root is derived by `lib/agent/session-paths.ts`: `OS_AGENT_SESSIONS_DIR`, or the current operating-system user's `~/.mso/agent-sessions`. The same resolver supplies durable records and artifact paths.

```text
<session-root>/
  <session-id>.json                 durable conversation record
  temp/
    <authenticated-principal-hash>/
      <session-id>/
        manifest.json               sole artifact catalog
        incoming/                   browser-produced files
        screenshots/                validated, named originals
        reports/                    validated JSON evidence
```

`agent_session_current`, CLI session API responses, and session summaries return an `artifacts` object containing `directory`, `incomingDirectory`, `screenshotsDirectory`, `manifestPath`, retention and limits. These absolute locations are computed when returned, not duplicated in saved session JSON. The manifest stores relative paths, so moving a configured root does not leave stale absolute file references. The CLI `/status` displays the returned temp and manifest locations.

The authenticated client principal and exact session are separate identity boundaries. Another token principal cannot select arbitrary sessions by guessing their ID. MSO still runs as one Unix account: an owner-approved arbitrary shell has that Unix account's filesystem power. This feature does not claim to sandbox hostile programs running as the same OS user or to create a new multi-tenant operating system.

## Browser workflow

Session-bound `exec_run` and `exec_job_start` inject only these non-secret values:

- `MSO_SESSION_ID`
- `MSO_SESSION_TEMP_DIR`
- `MSO_SCREENSHOT_DIR` — the session's `incoming/` directory
- `MSO_ARTIFACT_MANIFEST`

They are internal context, not an unrestricted user-supplied environment override. Use `umask 077` before producing files. A Playwright producer can use its existing browser setup:

```js
import { join } from "node:path";
if (!process.env.MSO_SCREENSHOT_DIR) throw new Error("Run in an MSO session");
await page.screenshot({
  path: join(process.env.MSO_SCREENSHOT_DIR, "home-fr-mobile.png"),
  fullPage: false,
});
```

Then call `session_artifact_register` with the actual project, environment, producer and 1–40 file descriptors. Each descriptor contains a staged basename, feature, optional locale, actual viewport width/height and source page URL. No arbitrary source directory is accepted. Query strings, fragments and URL credentials are omitted from the stored source URL.

Example final basename:

```text
mso__portfolio__home__production__fr__390x844__20260905t120000000z__a1b2c3d4.png
```

The manifest records artifact ID, descriptive filename, relative path, MIME type, byte length, SHA-256, creation time, producer, feature, viewport, locale and workflow ID. An identical registration retry returns the existing entry instead of accumulating duplicate originals. Raw staged input is retained until session retention cleanup; it is not removed during a registration retry, avoiding producer-file replacement races.

`session_artifacts` lists metadata with pagination. Supply an `artifact_id` to return an image or bounded JSON evidence. Large images may be resized for the tool preview; the original file and its checksum remain unchanged. A missing/expired or modified artifact produces an explicit failure, not a successful empty image. JSON reports containing recognizable credential-shaped text must be redacted before registration. Images can still visually contain sensitive content: capture public pages or redact the relevant interface before storing them.

`screen_capture` uses the same canonical store when a durable session exists. Its historical short-lived authenticated download link remains an export copy, not a second durable catalog. The existing filesystem credential denylist is not weakened to make `.mso` globally readable.

## Retention and quotas

Defaults: seven days of session/artifact inactivity, configurable through `OS_AGENT_ARTIFACT_RETENTION_DAYS` within 1–30 days. A prepared browser run gets a 30-minute lease, longer than the maximum 20-minute MSO exec job. New tool events update the durable session timestamp. Leased/recent sessions and the currently executing cleanup caller are preserved.

Automatic cleanup starts lazily on the first authenticated artifact preparation/write in a production process, then runs every 30 minutes. It does not start during imports, unit tests, or a build that never executes an authenticated artifact operation. After a restart, the next artifact operation reactivates the maintenance loop. No extra system daemon, hardcoded home directory, or global `/tmp` deletion is introduced.

Manual `session_artifacts_cleanup` defaults to dry-run. Explicit `dry_run:false` applies the same implementation to that client's dormant sessions. Cleanup validates ownership, directory/file types and expected names, and removes only known regular files in the fixed artifact subdirectories. It does not recursively delete an arbitrary path. Corrupt manifests, unknown files, symlinks, hard links, broad permissions and active locks are skipped for owner review. Durable session history is never deleted by artifact retention.

Managed originals are capped at 12 MiB each, 200 entries/128 MiB per session, and 1 GiB across one principal's registered artifacts. Registration also bounds the principal's temporary-session inventory to 128 directories. These are application-level **registered artifact** quotas, not a disk quota for arbitrary exec commands or all unrelated temporary files. Staged copies occupy additional space until retention cleanup.

## Shared implementation and verification

`artifact-paths` resolves locations and policy; `artifact-io` handles private file reads; `artifact-manifest` reuses the established private JSON store; `artifact-session` validates session ownership and emits execution context; `artifacts` owns registration/read; `artifact-cleanup` owns retention. All writes reuse MSO's existing cross-process lock. MCP tools are thin adapters, available to the CLI through its existing approved agent-tools bridge.

The catalog remains generic: no project-specific browser tool names are added. The new capabilities are `session_artifacts` (read), `session_artifact_register` (write), and `session_artifacts_cleanup` (write). Compact clients can need a tool-cache refresh after upgrading; changing MSO's toolset version does not remotely refresh ChatGPT.

Tests cover owner/session separation, private modes, traversal, symlinks/hard links, corrupt manifests, checksum changes, concurrent registration, quotas, idempotent retries, URL sanitization, leases, dry-run and bounded removal. A screenshot file and a passing browser test are evidence; neither is proof that a page's copy has received professional editorial review or that every possible device/accessibility condition was tested.
