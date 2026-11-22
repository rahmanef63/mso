#!/usr/bin/env bash
# Safe default for `bun run build`.
# Builds the Svelte 5 static bundle (`frontend/svelte/build`) under the checkout-wide
# runtime exclusion lock so a live MSO server never sees a partially written bundle.
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
    echo "mso build: refusing in-place build; live runtime pid $PID is serving this checkout" >&2
    echo "mso build: use 'mso build' to verify HEAD out-of-tree, or 'mso deploy' for a safe production rebuild" >&2
    exit 73
    ;;
  1) ;;
  *)
    echo "mso build: could not inspect live runtime ownership; refusing to mutate build output" >&2
    exit 74
    ;;
esac

cd "$ROOT"
bun run svelte:build
if command -v cargo >/dev/null 2>&1 && [ -f "$ROOT/rust-shell/Cargo.toml" ]; then
  (cd "$ROOT/rust-shell" && cargo build --release --bin mso-shell-host)
fi
