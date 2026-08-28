#!/usr/bin/env bash
# Official Codex Security component scan for MSO's large repository.
set -euo pipefail
umask 077

VERSION="${CODEX_SECURITY_VERSION:-0.1.21}"
AUTH="${CODEX_SECURITY_AUTH:-auto}"
FAIL_ON="${CODEX_SECURITY_FAIL_ON_SEVERITY:-high}"
WORKERS="${CODEX_SECURITY_COMPONENT_WORKERS:-2}"
MAX_COST="${CODEX_SECURITY_COMPONENT_MAX_COST_USD:-5}"
MODEL="${CODEX_SECURITY_MODEL:-gpt-5.6-terra}"
EFFORT="${CODEX_SECURITY_EFFORT:-high}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
PLAN="${CODEX_SECURITY_COMPONENT_PLAN:-$REPO_ROOT/security/codex-components.json}"
STATE_BASE="${CODEX_SECURITY_STATE_BASE:-$HOME/.mso/security-assurance/codex-security}"
STATE_DIR="${CODEX_SECURITY_STATE_DIR:-$STATE_BASE/state}"
OUTPUT_ROOT="${CODEX_SECURITY_OUTPUT_ROOT:-$STATE_BASE/$REPO_NAME-components}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_DIR="$OUTPUT_ROOT/$STAMP"
CLI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/codex-security-components.XXXXXX")"

cleanup() {
  rm -rf "$CLI_TMP"
}
trap cleanup EXIT INT TERM

[[ -f "$PLAN" && ! -L "$PLAN" ]] || { echo "Codex Security component plan is missing or unsafe." >&2; exit 2; }
[[ "$WORKERS" =~ ^[1-9][0-9]*$ ]] || { echo "CODEX_SECURITY_COMPONENT_WORKERS must be a positive integer." >&2; exit 2; }
[[ "$MAX_COST" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "CODEX_SECURITY_COMPONENT_MAX_COST_USD must be a positive number." >&2; exit 2; }

mkdir -p "$STATE_DIR" "$OUTPUT_ROOT"
chmod 700 "$STATE_DIR" "$OUTPUT_ROOT"

args=(
  --yes "@openai/codex-security@$VERSION"
  scan-components "$REPO_ROOT"
  --auth "$AUTH"
  --components-file "$PLAN"
  --workers "$WORKERS"
  --model "$MODEL"
  --effort "$EFFORT"
  --max-cost "$MAX_COST"
  --knowledge-base "$REPO_ROOT/SECURITY.md"
  --output-dir "$OUTPUT_DIR"
  --headless
)

cd "$CLI_TMP"
set +e
CODEX_SECURITY_STATE_DIR="$STATE_DIR" npx "${args[@]}"
scan_status=$?
set -e
if ((scan_status != 0)); then
  echo "Codex Security component scan did not complete with full coverage (exit $scan_status)." >&2
  exit 2
fi

node "$REPO_ROOT/scripts/check-codex-component-results.mjs" \
  "$OUTPUT_DIR/summary.json" \
  "$OUTPUT_DIR/findings.json" \
  "$FAIL_ON"
