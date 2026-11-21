#!/usr/bin/env bash
# Agent-facing pre-PR gate. Uses the same repository gates and scanner versions as CI.
# Exit 0 = selected LOCAL checks passed; remote CodeQL/reviews are never implied.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'HELP'
Usage: bash scripts/pr-preflight.sh [--local|--security|--full]
  --local      Verify committed code, strict audit, out-of-tree build and E2E.
  --security   Reproduce CI Semgrep and ShellCheck scans using pinned Docker images.
  --full       Both local and security (default).
Exit: 0 = selected local checks passed; 1 = check failed; 2 = cannot validate.
Never mark a PR ready until its required GitHub checks, CodeQL alerts and review
threads are also cleared. Open a Draft PR if a local check cannot run.
HELP
}
case "${1:---full}" in
  --local) mode=local ;;
  --security) mode=security ;;
  --full) mode=full ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 64 ;;
esac
if (($# > 1)); then usage >&2; exit 64; fi

block() { printf 'BLOCKED: %s\n' "$*" >&2; exit 2; }
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }
command -v git >/dev/null 2>&1 || block 'git is required'
command -v bash >/dev/null 2>&1 || block 'bash is required'

branch="$(git symbolic-ref --short -q HEAD)" || block 'detached HEAD; use a task branch'
[[ "$branch" != main && "$branch" != master ]] || block 'work on an isolated task branch, not main'
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || block 'uncommitted/untracked changes; commit intended changes and re-run'
git diff --check HEAD^ HEAD || fail 'commit contains whitespace errors'
git rev-parse --verify HEAD >/dev/null || block 'no committed HEAD'
printf 'MSO PR preflight | branch=%s | sha=%s | mode=%s\n' "$branch" "$(git rev-parse --short=12 HEAD)" "$mode"

if [[ "$mode" == local || "$mode" == full ]]; then
  command -v bun >/dev/null 2>&1 || block 'bun is required'
  [[ -d node_modules ]] || block 'install dependencies using bun install --frozen-lockfile'
  # This already includes typecheck, lint, coverage, policy checks, dependency
  # audit, the isolated build, and mandatory browser journeys. Never replace it
  # with a shortened "green" command.
  echo '>> Repository-owned pre-push verification'
  MSO_GATE_FULL=1 bash scripts/gates.sh || fail 'repository gates failed (see first error above)'
  echo '>> Fail-closed CI dependency audit'
  bun run audit:strict || fail 'strict dependency audit failed'
fi

if [[ "$mode" == security || "$mode" == full ]]; then
  command -v docker >/dev/null 2>&1 || block 'Docker unavailable; cannot reproduce CI security scanners'
  docker info >/dev/null 2>&1 || block 'Docker daemon unavailable'
  semgrep_image='semgrep/semgrep@sha256:f1f7b71861c7b28b6e0f661225a2c4f58a484f5d0f182465c6d6b3b22f972ade'
  shellcheck_image='koalaman/shellcheck-alpine@sha256:9955be09ea7f0dbf7ae942ac1f2094355bb30d96fffba0ec09f5432207544002'
  echo '>> Strict Semgrep with pinned CI image'
  docker run --rm -v "$ROOT:/src:ro" "$semgrep_image" \
    semgrep scan --metrics=off --config=p/javascript --config=p/typescript \
      --config=p/owasp-top-ten --strict --error /src \
    || fail 'Semgrep failed, including parser warnings; zero findings is not sufficient'
  echo '>> ShellCheck warning-level scan with pinned CI image'
  # NUL delimiters preserve valid paths with spaces.
  mapfile -d '' -t files < <(git grep -Ilz '^#!.*sh' -- '*.sh' 'bin/*' 'scripts/*' 'claude-skills/*' || true)
  args=()
  for file in "${files[@]}"; do args+=("/src/$file"); done
  if (("${#args[@]}" > 0)); then
    docker run --rm -v "$ROOT:/src:ro" "$shellcheck_image" \
      shellcheck --severity=warning -e SC1090,SC2034 "${args[@]}" \
      || fail 'ShellCheck warnings detected'
  fi
fi

[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail 'validation modified tracked/untracked sources; inspect and recommit'
echo "PASS: selected local preflight completed for $(git rev-parse --short=12 HEAD)."
echo 'REMOTE REQUIRED: open Draft PR, inspect all required GitHub checks, CodeQL alerts,'
echo 'and unresolved review threads. Only mark ready once all are clear.'
