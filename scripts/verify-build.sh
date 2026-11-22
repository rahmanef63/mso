#!/usr/bin/env bash
# verify-build.sh — prove HEAD actually compiles and passes mandatory release E2E,
# WITHOUT touching the .next that the live :4005 service is serving from.
#
# Why not simply run `next build` here, and why the pre-push hook keeps `--skip build`:
# the build's FIRST act is to delete everything in distDir except /^(cache|dev|lock)/
# (node_modules/next/dist/build/index.js, the 'clean' trace step). For ~30 s there is no
# .next/static, no .next/server, no BUILD_ID — and since two builds of byte-identical
# source emit different chunk filenames and a fresh BUILD_ID, every page already served
# keeps pointing at names that no longer exist even after it finishes. An in-place build
# in this directory is therefore an outage, not a check. docs/DEVELOPMENT.md says the
# same thing in prose; this script is the way to get the check without the outage.
#
# node_modules is COPIED, never symlinked. Turbopack hard-fails on a symlinked
# node_modules with "Symlink [project]/node_modules is invalid, it points out of the
# filesystem root". The copy costs ~7 s and the build writes nothing back into it.
#
# .env.local is deliberately NOT copied — the build succeeds without it, so no secret
# ever lands in a world-traversable /tmp path.
#
# Scope: this gates HEAD (the last commit), not the working tree, and always HEAD rather
# than the specific ref git hands the hook on stdin. That matches the commit-then-push
# flow this repo uses; pushing a non-HEAD ref would be gated against the wrong tree.
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"   # 0700
trap 'rm -rf "$TMP"' EXIT

git -C "$REPO" archive HEAD | tar -x -C "$TMP"
# Copy the contents, resolving a worktree's top-level dependency symlink only.
# Use --reflink=auto where supported for instant copy-on-write on large node_modules.
mkdir "$TMP/node_modules"
cp -a --reflink=auto "$REPO/node_modules/." "$TMP/node_modules/" 2>/dev/null \
  || cp -a "$REPO/node_modules/." "$TMP/node_modules/"

cd "$TMP"
MSO_VERIFY_BUILD_LOG="$TMP/build-output.log"
E2E_FILTER="${MSO_VERIFY_E2E_FILTER:-}"
E2E_JOBS="${MSO_E2E_JOBS:-2}"

journey_selected() {
  local id="$1"
  [ -z "$E2E_FILTER" ] && return 0
  [ "$E2E_FILTER" = "none" ] && return 1
  case ",$E2E_FILTER," in
    *,"$id",*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "== verify 1/3: isolated Next build"
# nice/ionice: this box also serves prod. A build gate must not starve :4005.
# A reviewed synthetic viewer origin is needed by iframe journeys. Never inherit
# an installation's public hostname into verification artifacts.
export NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE='{id}.mso.example.com'
if ! nice -n 15 ionice -c2 -n7 node node_modules/.bin/next build 2>&1 | tee "$MSO_VERIFY_BUILD_LOG"; then
  echo "verification failed during isolated compile/build" >&2
  exit 40
fi
if grep -Ei "(^|[[:space:]])warnings?[: ]|⚠" "$MSO_VERIFY_BUILD_LOG"; then
  echo "verification failed: build warnings are a release failure; resolve their source before shipping" >&2
  exit 41
fi

echo "== verify: eager shell bundle budget"
# The build described this exact archive, so the stale-build guard must not fire here.
MSO_BUNDLE_BUILD_IS_CURRENT=1 node scripts/check-bundle.mjs

if [ "$E2E_FILTER" = "none" ]; then
  echo "== verify 2/3 & 3/3: E2E skipped by MSO_VERIFY_E2E_FILTER=none"
else
  echo "== verify 2/3: Playwright Chromium runtime"
  if ! node scripts/ensure-playwright-browser.mjs; then
    echo "verification failed while preparing the browser required by release E2E" >&2
    exit 42
  fi

  run_e2e_step() {
    local id="$1" label="$2" script="$3"
    journey_selected "$id" || return 0
    echo "== verify ${label}"
    if ! node "$script"; then
      echo "verification failed during ${label}" >&2
      exit 43
    fi
  }

  run_e2e_step "release" "3/3: mandatory release E2E" "scripts/e2e/release.mjs"

  PARALLEL_SPECS=(
    "integrations-shell|native Integrations shell journey|scripts/e2e/integrations-shell.mjs"
    "integrations|Integrations credential actions (synthetic accounts)|scripts/e2e/integrations.mjs"
    "google-integrations|native Google Integrations UI (synthetic accounts)|scripts/e2e/google-integrations.mjs"
    "shell-status|shell-native server status|scripts/e2e/shell-status.mjs"
    "assistant-chat-ux|Assistant chat UX (synthetic tools and provider)|scripts/e2e/assistant-chat-ux.mjs"
    "bundle-performance|deferred shell performance|scripts/e2e/bundle-performance.mjs"
    "macos-figma|reviewed macOS chrome|scripts/e2e/macos-figma.mjs"
    "ios-lock|privacy-safe iOS lock|scripts/e2e/ios-lock.mjs"
  )

  if [ "$E2E_JOBS" -gt 1 ] 2>/dev/null; then
    PIDS=(); LOGS=(); LABELS=()
    active=0
    for spec in "${PARALLEL_SPECS[@]}"; do
      IFS='|' read -r id label script <<< "$spec"
      journey_selected "$id" || continue
      log="$TMP/e2e-${id}.log"
      echo "== verify ${label} (parallel job)"
      (node "$script" >"$log" 2>&1) &
      PIDS+=("$!"); LOGS+=("$log"); LABELS+=("$label")
      active=$((active + 1))
      if [ "$active" -ge "$E2E_JOBS" ]; then
        wait -n 2>/dev/null || true
        active=$((active - 1))
      fi
    done
    failed=0
    for i in "${!PIDS[@]}"; do
      if ! wait "${PIDS[$i]}"; then
        echo "verification failed during ${LABELS[$i]}" >&2
        failed=1
      fi
      cat "${LOGS[$i]}"
    done
    [ "$failed" -eq 0 ] || exit 43
  else
    for spec in "${PARALLEL_SPECS[@]}"; do
      IFS='|' read -r id label script <<< "$spec"
      run_e2e_step "$id" "$label" "$script"
    done
  fi
fi

# Optional artifact handoff so callers can promote this exact verified .next tree
# instead of running a redundant second build.
if [ -n "${MSO_EXPORT_NEXT_DIR:-}" ] && [ -d "$TMP/.next" ]; then
  rm -rf "$MSO_EXPORT_NEXT_DIR"
  mkdir -p "$(dirname "$MSO_EXPORT_NEXT_DIR")"
  cp -a --reflink=auto "$TMP/.next" "$MSO_EXPORT_NEXT_DIR" 2>/dev/null \
    || cp -a "$TMP/.next" "$MSO_EXPORT_NEXT_DIR"
  echo "== exported verified .next artifact to $MSO_EXPORT_NEXT_DIR"
fi

# Optional deeper media/native acceptance, using the same isolated built tree.
if [ "${1:-}" = "--extended" ]; then
  echo "== verify extended: desktop native acceptance"
  node scripts/e2e/desktop-native.mjs
  echo "== verify extended: preview acceptance"
  node scripts/e2e/preview.mjs
fi
