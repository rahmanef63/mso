#!/usr/bin/env bash
# Safe default for `bun run build`.
# A Next production server reads manifests/chunks from .next for its whole life.
# `next build` starts by deleting/replacing that tree, so running it in the same
# checkout as a live Next runtime creates a deterministic chunk/manifest outage.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"
# shellcheck source=scripts/lib/private-state.sh
. "$ROOT/scripts/lib/private-state.sh"
# shellcheck source=scripts/lib/runtime-exclusion.sh
. "$ROOT/scripts/lib/runtime-exclusion.sh"

runtime_exclusion_acquire_exclusive || {
  echo "mso build: another deploy/update/build owns this checkout; retry after it finishes" >&2
  exit 75
}
trap 'runtime_exclusion_release' EXIT INT TERM

set +e
LIVE="$(node "$ROOT/scripts/lib/live-runtime.mjs" "$ROOT" 2>/dev/null)"
LIVE_RC=$?
set -e
case "$LIVE_RC" in
  0)
    PID="$(printf '%s' "$LIVE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).pid||"?"))}catch{process.stdout.write("?")}})')"
    echo "mso build: refusing in-place Next build; live runtime pid $PID is serving this checkout" >&2
    echo "mso build: use 'mso build' to verify HEAD out-of-tree, or 'mso deploy' for a safe production rebuild" >&2
    exit 73
    ;;
  1) ;;
  *)
    echo "mso build: could not inspect live runtime ownership; refusing to mutate .next" >&2
    exit 74
    ;;
esac

NEXT="$ROOT/node_modules/next/dist/bin/next"
[ -f "$NEXT" ] || { echo "mso build: Next is not installed; run bun install" >&2; exit 69; }
cd "$ROOT"
# Keep the checkout-wide exclusion FD inherited by Node for the entire mutation.
node "$NEXT" build
