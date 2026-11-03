# Workspace and media fixes, 2026-11-04

Base: origin/main 266c24cb. Changes are local to the isolated workspace worktree. They are not deployed or PR-ready.

| Finding | Disposition and remaining evidence |
| --- | --- |
| WS-01 | Implemented explicit write result; failed Save and Close remains open with an error. Needs browser rejection/retry journey. |
| WS-02 | Implemented per-window working-set state, all-tab dirty guard, save-all, and tab close confirmation. Browser shell remount, partial save and focus return need verification. |
| WS-03 | Reports storage failure, flushes pending draft, hides saved status for session-only uploads, warns and guards exit, and offers a file chooser to relink each restored upload. Actual reload/media recovery needs browser testing; assets remain session-only and must be relinked after each reload. |
| WS-04 | Serialized host writes, status, retry and a close veto on incomplete save, with explicit discard. Pending changes flush on unmount/pagehide; browser teardown may interrupt requests, so verify failure, close/reload and out-of-order requests. |
| WS-05 | Payload identity resets paging, including reopening the same path; needs shell reuse journey. |
| WS-06 | Scoped arrows to focused window; needs editable, iframe and cross-window journey. |
| WS-07 | Unified fixed 44px list geometry and virtualizer; large text and touch geometry need browser measurement. |
| WS-08 | Added roving keyboard tabs and selected state; focus return, close controls and assistive technology need validation. |
| WS-09 | Search uses 16px text, 44px close and visible focus; focus return and real iOS verification remain. |
| WS-10 | Checks response, reports uncertain delivery and stops later input without replay; PTY journey needs testing. |
| WS-11 | Added separator semantics, keyboard resizing and pointer cancellation; mobile/AT journey needed. |
| WS-12 | Sequenced import requests, initial load and retry; delayed request and reopen tests needed. |
| WS-13 | Abort, revoke and activity cleanup on unmount; generation guard on callbacks. Actual render cancellation/download journey needed. |
| WSC-01 | Prevents a changed recovery slot being overwritten by stale draft; unchanged initial mount does not write. Conflict resolution UI and mounted cross-tab race test remain. |
| WSC-02 | Sample images pass their actual data URI; actions for samples without bytes are hidden in toolbar and inspector. Verify displayed sample flows. |
| WSC-03 | Defensive null/exception export handling retains window; normal reachability remains unverified. |
| WSC-04 | Deferred: not in confirmed scope; retry/power lifecycle was not changed. |

Validation with umask 077: targeted ESLint passed on changed source paths; TypeScript noEmit passed after final changes; architecture check and git diff --check passed; draft and media kinds tests passed 25/25, including a new quota failure check. Initial architecture check detected 48 files over 220; extracting draft lifecycle restored the ratchet to 47. No full build, full preflight, security scan, browser journeys, device testing, CI, or production runtime was run, by task direction. Targeted tests do not prove the untested behaviors listed above.

Follow-up: targeted draft and relink tests passed 22/22, including unrelated-asset preservation and incompatible MIME rejection; TypeScript, architecture and diff checks passed. Browser file chooser, actual decoding, reload, and rejected project-write journeys remain untested.
