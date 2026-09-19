#!/usr/bin/env bash
# Git remote policy for MSO self-update.
# Canonical MSO installs are public, so canonical SSH origins are normalized to
# public HTTPS before fetch. Non-canonical forks/private remotes are never rewritten.
MSO_CANONICAL_REMOTE_HTTPS="https://github.com/rahmanef63/mso.git"
UPDATE_ORIGIN_CLASS="unknown"

update_origin_is_canonical_url() {
  case "$1" in
    https://github.com/rahmanef63/mso|https://github.com/rahmanef63/mso.git|https://github.com/rahmanef63/mso/|https://github.com/rahmanef63/mso.git/|\
    git@github.com:rahmanef63/mso|git@github.com:rahmanef63/mso.git|\
    ssh://git@github.com/rahmanef63/mso|ssh://git@github.com/rahmanef63/mso.git)
      return 0 ;;
    *) return 1 ;;
  esac
}

update_origin_classify_url() {
  local url="$1"
  if update_origin_is_canonical_url "$url"; then
    printf 'canonical'
  else
    case "$url" in
      https://*|http://*) printf 'custom-https' ;;
      git@*:*|ssh://*) printf 'custom-ssh' ;;
      *) printf 'custom' ;;
    esac
  fi
}

update_prepare_origin() {
  local root="$1" url
  url="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
  [ -n "$url" ] || return 1
  UPDATE_ORIGIN_CLASS="$(update_origin_classify_url "$url")"
  if [ "$UPDATE_ORIGIN_CLASS" = canonical ] && [ "$url" != "$MSO_CANONICAL_REMOTE_HTTPS" ]; then
    git -C "$root" remote set-url origin "$MSO_CANONICAL_REMOTE_HTTPS" || return 1
  fi
}

update_git_fetch_origin() {
  local root="$1" ref="$2"
  shift 2
  update_prepare_origin "$root" || {
    printf 'MSO Git: origin is missing or unreadable.\n' >&2
    return 1
  }
  if ! GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -oBatchMode=yes}" \
    git -C "$root" fetch --quiet "$@" origin "$ref"; then
    printf 'MSO Git: fetch failed for %s origin; canonical installs use public HTTPS, while custom/private origins require preconfigured non-interactive credentials.\n' "$UPDATE_ORIGIN_CLASS" >&2
    return 1
  fi
}
