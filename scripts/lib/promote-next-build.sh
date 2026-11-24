#!/usr/bin/env bash
# Atomic swap helpers for promoting a verified staged build directory into place.
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

promote_staged_svelte_build() {
  local root="$1" staged="$2"
  local target="$root/frontend/svelte/build"
  local old="$root/frontend/svelte/build-previous"
  [ -f "$staged/index.html" ] || return 1
  rm -rf "$old"
  if [ -d "$target" ]; then
    mv "$target" "$old" || return 1
  fi
  if ! mv "$staged" "$target"; then
    [ -d "$old" ] && mv "$old" "$target" || true
    return 1
  fi
  rm -rf "$old"
  return 0
}
