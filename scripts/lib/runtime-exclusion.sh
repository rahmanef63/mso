#!/usr/bin/env bash
# Checkout-wide shared/exclusive lock preventing .next mutation under a fallback runtime.

RUNTIME_EXCLUSION_DIR=''
RUNTIME_EXCLUSION_FILE=''
RUNTIME_EXCLUSION_FD=''
RUNTIME_EXCLUSION_HELD=0

runtime_exclusion_init() {
  local canonical base key requested
  [ -n "$RUNTIME_EXCLUSION_FILE" ] && return 0
  canonical="$(realpath -e -- "$ROOT" 2>/dev/null || true)"
  [ -n "$canonical" ] || { printf 'cannot canonicalize runtime-exclusion checkout\n' >&2; return 1; }
  requested="${MSO_RUNTIME_EXCLUSION_DIR:-$HOME/.mso/private/runtime-exclusion}"
  base="$(mso_private_state_dir "$requested")" || return 1
  key="$(printf '%s' "$canonical" | sha256sum | awk '{print $1}')"
  [[ "$key" =~ ^[0-9a-f]{64}$ ]] || { printf 'cannot derive runtime-exclusion scope\n' >&2; return 1; }
  RUNTIME_EXCLUSION_DIR="$(mso_private_state_dir "$base/$key")" || return 1
  RUNTIME_EXCLUSION_FILE="$RUNTIME_EXCLUSION_DIR/runtime.lock"
  mso_private_state_ensure_file "$RUNTIME_EXCLUSION_FILE" >/dev/null || return 1
}

runtime_exclusion_acquire() {
  local mode="$1" timeout="$2" flag
  runtime_exclusion_init || return 1
  case "$mode" in shared) flag=-s ;; exclusive) flag=-x ;; *) return 2 ;; esac
  [[ "$timeout" =~ ^[0-9]+([.][0-9]+)?$ ]] || return 2
  exec {RUNTIME_EXCLUSION_FD}<>"$RUNTIME_EXCLUSION_FILE" || return 1
  if ! flock "$flag" -w "$timeout" "$RUNTIME_EXCLUSION_FD"; then
    exec {RUNTIME_EXCLUSION_FD}>&- || true
    RUNTIME_EXCLUSION_FD=''
    return 1
  fi
  RUNTIME_EXCLUSION_HELD=1
}

runtime_exclusion_acquire_shared() {
  runtime_exclusion_acquire shared "${MSO_RUNTIME_EXCLUSION_TIMEOUT_SECONDS:-12}"
}

runtime_exclusion_acquire_exclusive() {
  runtime_exclusion_acquire exclusive "${MSO_RUNTIME_EXCLUSION_UPDATE_TIMEOUT_SECONDS:-900}"
}

runtime_exclusion_release() {
  [ "$RUNTIME_EXCLUSION_HELD" = 1 ] || return 0
  if [ -n "${RUNTIME_EXCLUSION_FD:-}" ]; then
    flock -u "$RUNTIME_EXCLUSION_FD" 2>/dev/null || true
    exec {RUNTIME_EXCLUSION_FD}>&- || true
    RUNTIME_EXCLUSION_FD=''
  fi
  RUNTIME_EXCLUSION_HELD=0
}
