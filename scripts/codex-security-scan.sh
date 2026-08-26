#!/usr/bin/env bash
set -euo pipefail
umask 077

VERSION="${CODEX_SECURITY_VERSION:-0.1.18}"
MODE="${CODEX_SECURITY_MODE:-standard}"
AUTH="${CODEX_SECURITY_AUTH:-auto}"
FAIL_ON="${CODEX_SECURITY_FAIL_ON_SEVERITY:-high}"
MAX_COST="${CODEX_SECURITY_MAX_COST_USD:-5}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
STATE_BASE="${XDG_STATE_HOME:-$HOME/.local/state}/codex-security"
STATE_DIR="${CODEX_SECURITY_STATE_DIR:-$STATE_BASE/state}"
OUTPUT_ROOT="${CODEX_SECURITY_OUTPUT_ROOT:-$STATE_BASE/$REPO_NAME}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_DIR="$OUTPUT_ROOT/$STAMP/results"
CLI_TMP="$(mktemp -d "${TMPDIR:-/tmp}/codex-security-cli.XXXXXX")"

cleanup() {
  rm -rf "$CLI_TMP"
}
trap cleanup EXIT INT TERM

mkdir -p "$STATE_DIR" "$OUTPUT_ROOT" "$OUTPUT_DIR"
chmod 700 "$STATE_DIR" "$OUTPUT_ROOT" "$OUTPUT_DIR"

args=(
  --yes "@openai/codex-security@$VERSION"
  scan "$REPO_ROOT"
  --auth "$AUTH"
  --mode "$MODE"
  --output-dir "$OUTPUT_DIR"
  --fail-on-severity "$FAIL_ON"
  --max-cost "$MAX_COST"
)

if [[ "$MODE" == "deep" ]]; then
  args+=(--max-time-hours "${CODEX_SECURITY_MAX_TIME_HOURS:-1.5}")
fi
if [[ "${CODEX_SECURITY_DRY_RUN:-0}" == "1" ]]; then
  args+=(--dry-run)
fi
if [[ "${CI:-}" == "true" ]]; then
  args+=(--headless --json)
fi

cd "$CLI_TMP"
CODEX_SECURITY_STATE_DIR="$STATE_DIR" npx "${args[@]}"
