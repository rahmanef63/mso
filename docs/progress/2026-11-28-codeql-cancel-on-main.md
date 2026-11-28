# CodeQL: a cancelled main run is an unscanned commit

## What was broken

`security-alerts.yml` fails closed with one open CodeQL finding, and on 2026-11-28 that
finding was Scorecard alert 137 (`SASTID`): "score is 9: SAST tool detected but not run on
all commits. Warn: 29 commits out of 30 are checked with a SAST tool".

The missing commit was not a policy gap. `.github/workflows/codeql.yml` had

    concurrency:
      group: codeql-${{ github.ref }}
      cancel-in-progress: true

so a second push to `main` cancelled the run for the first one. Merging a batch of PRs
back to back (this session merged #390, #387, #386, #385, #383, #391 within minutes) left
`a18213fa` and every earlier commit in the burst with a cancelled analysis, which Scorecard
counts exactly as not scanned.

## Change

`cancel-in-progress` is now `${{ github.event_name == 'pull_request' }}`. A pull request
still cancels its own superseded run, which is the only place cancellation is desirable.
Pushes to `main` never cancel each other, so every landed commit gets an analysis.

No other workflow changes: `ci.yml` and `security-core.yml` keep `true`, because those
report per push and the newest run is the one that matters.

## Verification

- `npx vitest run scripts/security-alerts.test.ts` — 35/35 pass. That suite is the guard
  that pins `.github/workflows/codeql.yml` to `--tool CodeQL --inventory`, so the analysis
  job still only reports and the gate still lives in `security-alerts.yml`.
- `bunx yaml-lint .github/workflows/codeql.yml` — successful.

The alert itself clears when Scorecard next evaluates `main` after enough consecutive
scanned commits; this change is what stops new ones.
