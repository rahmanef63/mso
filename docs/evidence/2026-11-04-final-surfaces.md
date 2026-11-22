# Frontend surfaces final handoff, 2026-11-04

Base a2268f2b. This document distinguishes implementation from behavioral proof. The earlier
[handoff](2026-11-04-frontend-surfaces.md) records the prior candidate and remaining journeys.
No production provider, credential, installation, or external frame was used.

| ID | Implemented | Evidence and limits |
|---|---|---|
| PX-01 | Infrastructure superseded reads are aborted. | Prior candidate source; reversed delayed project and zone responses have not been rerun after the fix. |
| PX-02 | Loading, empty, failure, stale and refresh affordances are distinct. | Prior candidate source; 403, retry and provider-switch journeys remain unverified. |
| PX-03 | Same-origin, source-checked manager owner message; explicit named connection in panel; owner-only server validation; session cache scoped to selected and backing connection UIDs and backing revision. Legacy projected credentials bypass cache reads and writes. Selection changes clear results and abort requests. | Synthetic route tests exercise two owners, reuse, credential rotation, replacement of shared backing, legacy bypass and wrong-owner rejection. Browser owner-switch, out-of-order UI requests and manager-to-panel handshake remain unverified. No upstream call is made in tests. |
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

## Isolated rendered follow-up

At commit 2cb9325fc994358fbafd5fed62a9ffe5f20d26c4, headless Chromium mounted the
actual React Integrations and ExternalAppFrame components with synthetic network responses.
The manager was a same-origin message-emitting fixture, not the native manager; CSS came from
a previously built local checkout rather than a fresh build of this commit. The receipt is
`final-surfaces-rendered-receipt.json` in the external audit work folder. No fixture server was
retained.

- PX-03: Alice/first session creation was held in flight, then switching to Alice/second aborted
  it (`ERR_ABORTED`); the late URL did not appear. A second tools request was held, then
  switching the manager fixture to Bob aborted it; neither the prior nor late tool appeared.
  Captured requests used the selected owner and connection; Bob's session URL appeared. A
  selection message from the parent window rather than the manager frame was ignored.
  The actual native manager handshake, full shell and a real provider are not proven by this
  fixture.
- ST-03: A synthetic cross-origin response with `X-Frame-Options: DENY` produced the browser's
  framing denial. Open and recovery guidance remained after iframe load. In light and dark
  themes, viewport/container/iframe heights in pixels were 320x844 / 694 / 592, 390x844 /
  694 / 592, and 844x390 / 240 / 183. The compact toolbar hint was truncated at 320 and
  390 width (17.7 and 87.7 pixels available for 109 pixels of text); the longer footer was
  visible in these portrait fixtures. At 844x390 the compact hint fit. A deliberately shorter
  320-wide, 200-pixel container left 98 pixels for the frame; this is a stress result, not
  a measurement of the shell. The 844x390 result exceeds 120 pixels in this isolated
  container but does not replace the full-shell gate with current CSS or prove upstream
  readiness.
