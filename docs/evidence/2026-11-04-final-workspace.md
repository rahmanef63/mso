# Final workspace follow-up, 2026-11-04

Scope: isolated workspace branch based on origin/main a2268f2b, including PR #270. No host file writes, real terminal sessions, provider credentials, deployment, full build, or production browser were used. The implementation observations below are not a substitute for interactive acceptance across the five shells, both themes, and real mobile devices.

| Finding | Disposition and remaining evidence |
| --- | --- |
| WS-01 | Prior implementation returns write success and vetoes close on failure. Failed-write and retry UI journey remains to be exercised in a browser. |
| WS-02 | Prior implementation guards all dirty tabs, offers tab confirmation and keeps per-window state. Partial save, focus restoration, and shell remount need interactive proof. |
| WS-03 | Prior implementation reports storage failure, flushes drafts, warns for session-only uploads, and provides relinking. Reload, decoding and file-picker journey remain unverified. |
| WS-04 | Prior implementation serializes project writes and reports failure. This follow-up flushes pending project writes before image save, and retains dirty state when edits occur during an image save. Controlled write failure, retry and ordering need mounted UI proof. Browser teardown can still interrupt a request. |
| WS-05 | Payload identity is used for paging, with a new payload replacing the paged item. Actual shell reuse and same-path reopening remain untested. |
| WS-06 | Arrows use the focused-window hotkey helper. Editable, iframe and cross-window browser journeys remain untested. |
| WS-07 | Virtualizer and row use 44px geometry. Actual coarse-pointer and enlarged-text measurement remains untested. |
| WS-08 | Roving keyboard tab semantics implemented. Close focus restoration and assistive technology behavior remain unverified. |
| WS-09 | Search uses 16px text, 44px close target and focus style. Focus restoration and physical iOS verification remain untested. |
| WS-10 | Input request failures halt delivery and report uncertainty without replay. New tests exercise both HTTP and network failure, including queued and later input, using a mocked transport. Real PTY recovery remains untested. |
| WS-11 | Separator keyboard and pointer cancellation handling implemented. Mobile and assistive technology verification remains untested. |
| WS-12 | Import requests use sequence identity, initial loading and retry. Delayed-response browser journey remains untested. |
| WS-13 | Export abort, URL and activity cleanup implemented with generation checks. Actual rendering and download cancellation remain untested. |
| WSC-01 | Draft baseline now comes from the same storage read as the loaded composition, preventing another tab's intervening write from becoming a false baseline. Unchanged initial composition does not write, including repeated effects. A synthetic hook test reproduces the intervening write and confirms conflict reporting; real mounted cross-tab reload remains untested. |
| WSC-02 | Sample image actions pass sample bytes, and actions requiring unavailable bytes are hidden. Actual sample rendering and both action paths remain untested. |
| WSC-03 | Null or throwing export retains the editor and reports an error. This follow-up also avoids marking a later revision clean on async save completion. Mounted canvas failure and retry remain untested. |
| WSC-04 | Unmount now aborts the current retry/power controller, session fetch receives its signal, late status/transport updates are guarded, and superseded power operations cannot clear a newer busy state. Mocked delayed operation and actual noVNC lifecycle still need interactive proof. |

Validation: targeted draft, relink and media-kind tests passed 28 tests; new terminal delivery tests passed 2; new draft race hook test passed 1. TypeScript, targeted ESLint and architecture checks were run; see final task report for final rerun results. The draft hook test uses a synthetic hook scheduler, not React DOM. Existing tests and source review do not prove the outstanding UI journeys above.
