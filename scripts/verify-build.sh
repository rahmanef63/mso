#!/usr/bin/env bash
# verify-build.sh — prove HEAD compiles (Svelte 5 + TypeScript + Rust Shell) and passes
# mandatory release browser E2E out-of-tree without touching a live runtime checkout.
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"   # 0700
trap 'rm -rf "$TMP"' EXIT

git -C "$REPO" archive HEAD | tar -x -C "$TMP"
mkdir -p "$TMP/node_modules" "$TMP/frontend/svelte/node_modules"
cp -a --reflink=auto "$REPO/node_modules/." "$TMP/node_modules/" 2>/dev/null \
  || cp -a "$REPO/node_modules/." "$TMP/node_modules/"
if [ -d "$REPO/frontend/svelte/node_modules" ]; then
  cp -a --reflink=auto "$REPO/frontend/svelte/node_modules/." "$TMP/frontend/svelte/node_modules/" 2>/dev/null \
    || cp -a "$REPO/frontend/svelte/node_modules/." "$TMP/frontend/svelte/node_modules/"
fi

cd "$TMP"
MSO_VERIFY_BUILD_LOG="$TMP/build-output.log"
E2E_FILTER="${MSO_VERIFY_E2E_FILTER:-}"

echo "== verify 1/3: isolated Svelte 5 production build + typecheck"
export NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE='{id}.mso.example.com'
if ! nice -n 15 ionice -c2 -n7 bun run svelte:check 2>&1 | tee "$MSO_VERIFY_BUILD_LOG"; then
  echo "verification failed during Svelte check" >&2
  exit 40
fi
if ! nice -n 15 ionice -c2 -n7 bun run svelte:build 2>&1 | tee -a "$MSO_VERIFY_BUILD_LOG"; then
  echo "verification failed during isolated Svelte build" >&2
  exit 40
fi

if [ "$E2E_FILTER" = "none" ]; then
  echo "== verify 2/3 & 3/3: E2E skipped by MSO_VERIFY_E2E_FILTER=none"
else
  echo "== verify 2/3: Playwright Chromium runtime"
  if ! node scripts/ensure-playwright-browser.mjs; then
    echo "verification failed while preparing the browser required by release E2E" >&2
    exit 42
  fi

  echo "== verify 3/3: mandatory Svelte 5 browser E2E"
  if ! bun run svelte:e2e; then
    echo "verification failed during Svelte 5 browser E2E" >&2
    exit 43
  fi
fi

if [ -n "${MSO_EXPORT_SVELTE_DIR:-}" ] && [ -d "$TMP/frontend/svelte/build" ]; then
  rm -rf "$MSO_EXPORT_SVELTE_DIR"
  mkdir -p "$(dirname "$MSO_EXPORT_SVELTE_DIR")"
  cp -a --reflink=auto "$TMP/frontend/svelte/build" "$MSO_EXPORT_SVELTE_DIR" 2>/dev/null \
    || cp -a "$TMP/frontend/svelte/build" "$MSO_EXPORT_SVELTE_DIR"
  echo "== exported verified Svelte build artifact to $MSO_EXPORT_SVELTE_DIR"
fi
