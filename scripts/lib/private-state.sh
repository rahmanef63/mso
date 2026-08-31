#!/usr/bin/env bash
# Shared private-state primitives for shell clients that persist live session material.
# Callers must already use `set -euo pipefail` and handle a non-zero return as fatal.

mso_private_state_error() {
  printf 'private state: %s\n' "$*" >&2
  return 1
}

mso_private_state_dir() {
  local requested="${1:-}" created=0 canonical owner mode old_umask
  [ -n "$requested" ] || { mso_private_state_error "empty directory path"; return 1; }
  case "$requested" in /*) ;; *) mso_private_state_error "directory must be absolute: $requested"; return 1 ;; esac
  [ ! -L "$requested" ] || { mso_private_state_error "refusing symlink directory: $requested"; return 1; }

  if [ ! -e "$requested" ]; then
    old_umask=$(umask)
    umask 077
    mkdir -p -- "$requested"
    umask "$old_umask"
    created=1
  fi
  [ -d "$requested" ] && [ ! -L "$requested" ] || {
    mso_private_state_error "not a real directory: $requested"
    return 1
  }

  canonical=$(realpath -e -- "$requested") || {
    mso_private_state_error "cannot resolve directory: $requested"
    return 1
  }
  owner=$(stat -c '%u' -- "$canonical") || return 1
  mode=$(stat -c '%a' -- "$canonical") || return 1
  [ "$owner" = "$(id -u)" ] || {
    mso_private_state_error "directory is not owned by uid $(id -u): $canonical"
    return 1
  }
  if [ "$created" = 1 ]; then
    chmod 700 -- "$canonical"
    mode=$(stat -c '%a' -- "$canonical") || return 1
  fi
  [ "$mode" = 700 ] || {
    mso_private_state_error "directory must be mode 0700, got $mode: $canonical"
    return 1
  }
  printf '%s' "$canonical"
}

mso_private_state_path() {
  local requested="${1:-}" parent name canonical_parent
  [ -n "$requested" ] || { mso_private_state_error "empty file path"; return 1; }
  case "$requested" in /*) ;; *) mso_private_state_error "file path must be absolute: $requested"; return 1 ;; esac
  parent=$(dirname -- "$requested")
  name=$(basename -- "$requested")
  [ -n "$name" ] && [ "$name" != . ] && [ "$name" != / ] || {
    mso_private_state_error "invalid file name: $requested"
    return 1
  }
  canonical_parent=$(mso_private_state_dir "$parent") || return 1
  printf '%s/%s' "$canonical_parent" "$name"
}

mso_private_state_validate_file() {
  local resolved owner mode
  resolved=$(mso_private_state_path "${1:-}") || return 1
  [ ! -L "$resolved" ] || {
    mso_private_state_error "refusing symlink file: $resolved"
    return 1
  }
  [ -e "$resolved" ] || {
    mso_private_state_error "file does not exist: $resolved"
    return 1
  }
  [ -f "$resolved" ] || {
    mso_private_state_error "not a regular file: $resolved"
    return 1
  }
  owner=$(stat -c '%u' -- "$resolved") || return 1
  mode=$(stat -c '%a' -- "$resolved") || return 1
  [ "$owner" = "$(id -u)" ] || {
    mso_private_state_error "file is not owned by uid $(id -u): $resolved"
    return 1
  }
  [ "$mode" = 600 ] || {
    mso_private_state_error "file must be mode 0600, got $mode: $resolved"
    return 1
  }
  printf '%s' "$resolved"
}

mso_private_state_ensure_file() {
  local resolved parent tmp old_umask
  resolved=$(mso_private_state_path "${1:-}") || return 1
  if [ -e "$resolved" ] || [ -L "$resolved" ]; then
    mso_private_state_validate_file "$resolved"
    return
  fi

  parent=$(dirname -- "$resolved")
  old_umask=$(umask)
  umask 077
  tmp=$(mktemp "$parent/.mso-private-state.XXXXXX")
  umask "$old_umask"
  chmod 600 -- "$tmp"
  if ! mv -Tn -- "$tmp" "$resolved"; then
    rm -f -- "$tmp"
  fi
  mso_private_state_validate_file "$resolved"
}

mso_private_state_atomic_write() {
  local resolved parent tmp old_umask
  resolved=$(mso_private_state_path "${1:-}") || return 1
  if [ -e "$resolved" ] || [ -L "$resolved" ]; then
    mso_private_state_validate_file "$resolved" >/dev/null || return 1
  fi
  parent=$(dirname -- "$resolved")
  old_umask=$(umask)
  umask 077
  tmp=$(mktemp "$parent/.mso-private-write.XXXXXX")
  umask "$old_umask"
  trap 'rm -f -- "${tmp:-}"' RETURN
  if ! cat >"$tmp"; then rm -f -- "$tmp"; tmp=''; trap - RETURN; return 1; fi
  if ! chmod 600 -- "$tmp"; then rm -f -- "$tmp"; tmp=''; trap - RETURN; return 1; fi
  if ! mv -fT -- "$tmp" "$resolved"; then rm -f -- "$tmp"; tmp=''; trap - RETURN; return 1; fi
  tmp=''
  trap - RETURN
  mso_private_state_validate_file "$resolved"
}

mso_private_state_remove_file() {
  local resolved
  resolved=$(mso_private_state_path "${1:-}") || return 1
  if [ ! -e "$resolved" ] && [ ! -L "$resolved" ]; then
    return 0
  fi
  mso_private_state_validate_file "$resolved" >/dev/null || return 1
  rm -f -- "$resolved"
}
