# Final agent and collaboration audit follow-up

Base a2268f2b includes the earlier changes described in [frontend agent evidence](2026-11-04-frontend-agents.md). This follow-up is not browser or release acceptance.

| Finding | Current result and evidence / limit |
| --- | --- |
| AD-01 | Existing app keeps ChatPanel mounted under the form. Source inspection confirms the same instance is hidden; no live streaming, wire-history, thread restart, or shell remount test was run. |
| AD-02, AD-10, AC-01 | Existing editors hold their original revisions and latest-request guards; conflict retains the draft. A real GroupEditor component fixture modeled concurrent actor B, refreshed props to revision 11 and confirmed submission retained revision 10, conflict surfaced and actor B stayed intact. Existing earlier ChannelEditor fixture covered its revision 10/11 flow. Fixtures use mocked APIs; overlapping response, new-draft refresh and cancel need browser coverage. This follow-up also keeps the save error visible if the recovery refresh fails. |
| AD-03, WF-01, WF-02 | Existing duplicate saves dirty graph before clone; source copy and restore ask before mutation; delete names target and warns of dirty state. This follow-up puts source copy and restore under the per-window action lock, temporarily disables graph editing during pending actions, and retains a newer draft if replacement races an edit. A mounted VersionPanel fixture confirmed cancel sends no restore and two activations issue one pending restore using a modeled lock. Full app-level duplicate, source, delete, failure and pending-edit journeys remain untested. |
| AD-04, AD-11 | Existing Organization deletion confirmation, pending state and named controls inspected; no live mutation, focus or responsive accessibility proof. |
| AD-05 | Existing variable save/delete guards, confirmation and error state inspected; no mutation/error interaction fixture. |
| AD-06 | Existing form labels and associations; two tracked static form tests passed. No screen reader test. |
| AD-07, AD-08 | Existing memory keyboard selection, pan, zoom, fit and separate no-match state inspected; two tracked pure view tests passed. No browser keyboard, pointer or visual proof. |
| AD-09 | Existing Memory and Vault storage exception handling inspected; no throwing-storage fixture run. |
| AD-12 | Existing member fieldsets and labels inspected. Group CAS fixture mounted those controls; no narrow viewport or focus proof. |
| AD-13 | Investigation only; frame readiness remains unknown. No origin, CSP, service, or iframe success changes. |
| Managed install | Existing clipboard consumer awaits the boolean result; static Orca tests passed. No real clipboard or installation proof. |

Validation: Node 22, umask 077, VITEST_MAX_WORKERS=2. Two isolated component fixtures passed (GroupEditor CAS and VersionPanel cancellation/single-flight); they live in ignored .agent/evidence/final-agents and use the audit's external react-test-renderer installation, so are not portable CI tests. Five tracked test files passed 15 tests, including 2 form, 2 memory transform and 7 Orca static tests. TypeScript, targeted ESLint, and diff check passed. No full build, security scan, PR gates, real API, browser, assistive technology, actual device or remote CI was run; integration owner must run applicable gates and behavioral journeys on the final SHA.

## Mounted replacement cancellation follow-up

A synthetic React test-renderer fixture mounted the actual WorkflowsApp, source and version panels with mocked network, shell and visual children. Cancelling Duplicate, Restore and Copy each asked for confirmation; zero update/clone/restore/POST calls were made and the dirty workflow name remained. Source was 1367a24b. This tests application-level cancellation, not browser focus, real API persistence or full-shell rendering. Receipts are final-workspace-mounted-receipt JSON/Markdown in the external audit work folder.
