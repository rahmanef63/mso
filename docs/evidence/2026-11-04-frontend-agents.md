# Frontend agents and collaboration changes, 2026-11-04

Base: origin/main 266c24cb. This is implementation evidence, not a release or browser acceptance report.

| Finding | Before and after / state owner |
| --- | --- |
| AD-01 | Opening a form returned early and unmounted ChatPanel. The app now hides its mounted frame while rendering a form, preserving the same ChatPanel runner, wire-history ref and thread persistence refs for the lifetime of the mounted Assistant window. Shell remount persistence still requires verification. |
| AD-02, AD-10, AC-01 | Channels and groups capture the revision in each editor session, keep a stable new-editor key, guard dirty dismissal, reject older load responses and expose latest saved fields alongside a retained draft after failed save. Adopting the latest revision is an explicit overwrite choice. State stays local to each app/editor. A mocked two-writer ChannelEditor fixture confirms a revision-10 draft does not overwrite revision 11; group parity and browser interactions remain untested. |
| AD-03, WF-01 | Duplicate asks to save a dirty graph before cloning. Owner-source copy and version restore call the existing dirty guard before mutation. Workflow state remains owned by the exact window. |
| WF-02 | Delete confirms the named graph and warns about dirty changes; existing busy/error state handles feedback. A synchronous double-activation test remains outstanding. |
| AD-04, AD-11 | Organization editor confirms named deletion and uses pending/error state; narrow unit and seat actions have accessible names and titles. |
| AD-05 | Variable save/delete have pending guards; delete names and confirms the variable, failures are reported, and fields are named. |
| AD-06 | Form fields associate individual controls with unique labels and hints; multi-control pickers use fieldsets. Static rendering tests cover associations. |
| AD-07, AD-08 | Memory nodes select with Space and open with Enter; canvas has bounded zoom, fit, arrow-key pan and pointer cancellation. Empty data and filtered no-match are distinguished; reset changes filters only. Browser keyboard, pointer, layout and focus-indicator validation remains outstanding. |
| AD-09 | Memory and Vault treat preference storage failure as nonfatal; loading is independent of preference persistence. |
| AD-12 | Group members use fieldsets with persistent labels, named remove actions and container-responsive layout. Focus after removal and narrow layouts still require browser proof. |
| AD-13 | Investigation only. No iframe readiness assertion or security boundary change was made. |
| Integration | Managed installer awaits clipboard result, avoiding false success when shell copy returns false. |

Source: frontend/slices/{assistant,channels,agent-group,workflows,organization,memory-graph,agent-vault,managed-apps}. No backend, credential or service policy changes.

Validation with umask 077, Node 22 and VITEST_MAX_WORKERS=2:
- TypeScript tsc --noEmit --pretty false passed.
- ESLint on changed slices and git diff --check passed.
- bun run test frontend/slices/assistant/components/form-shell.test.tsx passed 2 tests.
- bun run test frontend/slices/channels/app.test.ts frontend/slices/agent-group/app.test.ts frontend/slices/memory-graph/lib/view.test.ts frontend/slices/managed-apps/orca-app.test.tsx passed 13 existing tests; these mostly cover registration, pure transforms and static rendering.
- An isolated React test-renderer fixture adapted from the audit mounted the real ChannelEditor at revision 10, updated its snapshot to 11 and asserted its save sent 10 and the mocked server retained actor B's target. It passed. This fixture resides in ignored .agent/evidence/frontend-agents and borrows the audit's untracked renderer dependency, so it is not a portable CI test.

Not run: full build, pr:local, pr:security, CI, actual API/server mutations, browser journeys across shells/themes/mobile, screen reader, real streams, lifecycle/remount, group two-writer, deferred response ordering, workflow error/double-click and storage exception fixtures. The user requested no full build or preflight in this task. These gaps preclude a readiness or shipped claim.

Next agent: rerun the targeted tests above; add portable interaction fixtures for the scenarios listed, then run repository PR gates and browser journeys on the exact integrated SHA. In particular verify chat request wire history/thread identity after all three forms, group CAS and conflict recovery, copy/restore cancellation with zero mutations, delete single-flight, storage exceptions, and 320px/200% text in both themes.
