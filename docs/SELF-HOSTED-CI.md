# Self-hosted CI — manual verification pilot

**Current implementation: pilot, not a completed GitHub Actions migration.**
MSO runs repository-owned checks; Batonly tracks delivery evidence. GitHub remains
source control. No Actions dispatch, service, webhook, schedule, credential export,
production deployment, or remote status writer is created by this runner.

## Use

From a trusted clean committed repository root with dependencies installed:

```sh
bun run ci:plan
bun run ci:verify --sha "$(git rev-parse HEAD)"
bun run ci:release --sha "$(git rev-parse HEAD)"
bun run test:ci
```

`verify` checks native node-pty, installer syntax and existing `scripts/gates.sh`.
The committed gate remains authoritative for typecheck, lint, coverage, repository/docs
checks, changelog freshness, strict audit, isolated build and release-browser journeys.
Do not run this pilot on an untrusted fork as an unattended worker: it is not a sandbox.

`security` and `release` intentionally return BLOCKED until scanner adapters and provider
evidence are verified. No selected commands execute when a prerequisite is blocked.
A verify PASS does not imply security parity, deployment approval or production health.

## Evidence and concurrency

Private reports/logs: `${XDG_STATE_HOME:-$HOME/.local/state}/mso-ci/runs/<run-id>/`.
Directories are 0700 and files 0600. CLI output is statuses/report path, not raw logs.
Only an environment allowlist reaches child commands; provider credentials and Git hook
variables are not inherited. Commands select noninteractive modes explicitly; the runner
does not inject a global CI flag that changes the existing local gate behavior.
Review/redact private logs before any external sharing.

Reports record exact SHA, PASS/FAIL/BLOCKED/NOT_RUN, timings and process outcomes.
Missing prerequisites, timeout, cancellation and truncated evidence never pass.
Source SHA and clean state are checked before/after execution. Cooperating invocations
share a host lock and repository-identity lock and must use the same state root.
These locks do not control unrelated agents/manual jobs; audit those before heavy work.
After a crash, verify the recorded process/workflow is gone before removing its exact
stale lock. There is no automatic takeover of another job's lock.

The runner never attests merged/deployed/verifiedLive/releaseEligible or automatic
Batonly sync. Those fields stay false/UNSYNCED, even when verification passes.
A future delivery adapter must verify and persist those separate transitions.

## Migration matrix

| Existing workflow | Standalone replacement / remaining gate |
| --- | --- |
| `ci.yml` | Pilot reuses committed gates. Prove full exact-SHA run; preserve dependency monitoring separately. |
| `codeql.yml` | Reviewed CodeQL bundle, security-extended analysis, existing SARIF validator and exact-SHA upload/read-back. BLOCKED. |
| `security-core.yml` | Preserve pinned Trivy/OSV/Gitleaks/Semgrep/ShellCheck and `scripts/security-ultimate.sh`; verify standalone adapters. BLOCKED. |
| `dependency-review.yml` | Explicit base/head dependency delta and vulnerability policy; a lockfile audit alone is not equivalent. BLOCKED. |
| `security-alerts.yml` | Existing alert inventory through selected private integration; confirm exact-SHA analyses rather than old evidence. BLOCKED. |
| `scorecard.yml` | Reviewed standalone Scorecard and policy/evidence handling; no unapproved public result publication. BLOCKED. |
| `dast.yml` | Explicit isolated staging target, pinned ZAP policy, complete evidence. BLOCKED. |
| `codex-security.yml` | Existing manual paid scan remains separately approval-gated. Never automatically invoked or claimed passed. |

GitHub supports external code scanning and commit statuses independently of Actions:
- https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/use-with-existing-ci-system
- https://docs.github.com/en/rest/commits/statuses

## Batonly and cutover

Use MSO project_mcp_tools/project_mcp_call against the selected Batonly integration.
Discover exact schemas/project/task identities. Record scope, SHA, results and evidence
references, not raw logs/secrets. Use expectedVersion/expectedRevision, refresh conflicts,
read back writes, preserve history, and leave unexecuted checklist items open.
This pilot has no automatic Batonly writer or dashboard Run/Rerun button.

Do not disable security gates or declare Actions migration complete from this pilot.
Complete and verify scanner parity, representative pass/fail runs, trusted status
publication and authenticated triggers before changing required checks/disabling Actions.
Untrusted forks need a separate secret-free sandbox. Webhooks need signature, replay,
repository/branch allowlist and commit freshness checks; this CLI is not a webhook API.

Deployment stays on the existing exact-merged-SHA release path with explicit approval,
build-before-restart, health/browser proof and rollback. Never verify by building in the
live production directory. A successful CI run is not a deployment receipt.
