# Frontend surfaces final handoff, 2026-11-04

Base a2268f2b. This document distinguishes implementation from behavioral proof. The earlier
[handoff](2026-11-04-frontend-surfaces.md) records the prior candidate and remaining journeys.
No production provider, credential, installation, or external frame was used.

| ID | Implemented | Evidence and limits |
|---|---|---|
| PX-01 | Infrastructure superseded reads are aborted. | Prior candidate source; reversed delayed project and zone responses have not been rerun after the fix. |
| PX-02 | Loading, empty, failure, stale and refresh affordances are distinct. | Prior candidate source; 403, retry and provider-switch journeys remain unverified. |
| PX-03 | Same-origin, source-checked manager owner message; explicit named connection in panel; owner-only server validation; session cache scoped to connection UID, backing revision and credential digest. Selection changes clear results and abort requests. | Synthetic route tests exercise two owners, two keys, reuse, rotation and wrong-owner connection rejection; 38 focused tests pass. Browser owner-switch, out-of-order UI requests and manager-to-panel handshake remain unverified. No upstream call is made in tests. |
| PX-04 | Create App fields have associated labels. | Prior candidate source; label click and multiple-window browser checks remain unverified. |
| PX-05 | Accent swatches wrap and expose selection. | Prior candidate source; coarse 320/390 and 200% text checks remain unverified. |
| PX-06 | Nonsecret drafts are scoped to window with discard guards. | Prior candidate source; remount, two windows and cancelled discard remain unverified. |
| PX-07 | Failed n8n refresh identifies retained embed as stale. | Prior candidate source; 3 existing n8n embed tests pass, but success-to-rejection/retry is not covered by them. |
| PX-08 | Monitor identifies stale telemetry and process failures, and ignores superseded polls. | Prior candidate source; slow, hidden, disconnected and recovery journeys remain unverified. |
| PX-09 | Composio disclosure has a 40% height cap and internal scrolling. | Source inspection; 100/500 tools, keyboard and short viewport measurements remain unverified after the panel change. |
| ST-01 | Browser registry writes precede published state; failure is shown. | Prior candidate source; quota failure and retry for all operations remain unverified. |
| ST-02 | Skills refresh publishes one generation and serializes writes. | Prior candidate source; reversed responses and concurrent mutation journey remain unverified. |
| ST-03 | Frame guidance states embedding cannot be verified and gives an Open fallback; compact toolbar retains fallback guidance at short heights. Sandbox, origin and links are unchanged. | Source inspection and 3 existing n8n embed tests; denied-frame load, timeout and 844x390 geometry remain unverified. Cross-origin content readiness cannot be observed from iframe load. |

Scoped checks: TypeScript, changed-file ESLint, architecture ratchet, 38 Composio/manager tests,
and 11 existing integration/n8n/domain/extension tests passed. Existing tests outside PX-03 do
not establish the pending journeys above. Full build, security preflight, browser journeys and
remote checks belong to the integration owner and are not asserted here. Revert this commit to
roll back this incremental patch; prior candidate fixes are on the base.
