#!/usr/bin/env bash
# Atomic swap helper for promoting a verified staged .next directory into place.
# Falls back cleanly if no staged artifact exists.

promote_staged_next_build() {
  local root="$1" staged="$2"
  local old="$root/.next-previous"
  [ -f "$staged/BUILD_ID" ] || return 1
  rm -rf "$old"
  if [ -d "$root/.next" ]; then
    mv "$root/.next" "$old" || return 1
  fi
  if ! mv "$staged" "$root/.next"; then
    [ -d "$old" ] && mv "$old" "$root/.next" || true
    return 1
  fi
  rm -rf "$old"
  return 0
}
