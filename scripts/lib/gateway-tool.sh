#!/usr/bin/env bash
# Pinned cloudflared resolver/installer. The public gateway never executes a mutable
# `latest` artifact and needs no root package install.

GATEWAY_ARTIFACT_LOCK="${MSO_GATEWAY_ARTIFACT_LOCK:-$ROOT/security/gateway-artifacts.env}"
GATEWAY_TOOL_ROOT="${MSO_GATEWAY_TOOL_DIR:-$HOME/.mso/tools/cloudflared}"

# shellcheck source=security/gateway-artifacts.env
[ -r "$GATEWAY_ARTIFACT_LOCK" ] || gateway_fail "missing gateway artifact lock: $GATEWAY_ARTIFACT_LOCK"
. "$GATEWAY_ARTIFACT_LOCK"

_gateway_tool_expected() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s\t%s\n' "$CLOUDFLARED_LINUX_AMD64_URL" "$CLOUDFLARED_LINUX_AMD64_SHA256" ;;
    aarch64|arm64) printf '%s\t%s\n' "$CLOUDFLARED_LINUX_ARM64_URL" "$CLOUDFLARED_LINUX_ARM64_SHA256" ;;
    *) gateway_fail "unsupported architecture for automatic cloudflared install: $(uname -m). Set MSO_GATEWAY_CLOUDFLARED to a reviewed binary." ;;
  esac
}

_gateway_tool_validate() {
  local file="$1" expected="$2" owner mode actual
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  owner="$(stat -c '%u' -- "$file" 2>/dev/null || true)"; [ "$owner" = "$(id -u)" ] || return 1
  mode="$(stat -c '%a' -- "$file" 2>/dev/null || true)"; [[ "$mode" =~ ^[0-7]{3,4}$ ]] || return 1
  (( (8#$mode & 022) == 0 )) || return 1
  actual="$(sha256sum "$file" 2>/dev/null | awk '{print $1}')"
  [ "$actual" = "$expected" ] || return 1
  [ -x "$file" ]
}

gateway_resolve_cloudflared() {
  local override="${MSO_GATEWAY_CLOUDFLARED:-}" url expected dir dest tmp actual
  if [ -n "$override" ]; then
    case "$override" in /*) ;; *) gateway_fail "MSO_GATEWAY_CLOUDFLARED must be an absolute path" ;; esac
    [ -f "$override" ] && [ ! -L "$override" ] && [ -x "$override" ] \
      || gateway_fail "cloudflared override must be an executable regular non-symlink file: $override"
    CLOUDFLARED="$(realpath -e -- "$override")"
    return 0
  fi

  IFS=$'\t' read -r url expected < <(_gateway_tool_expected)
  dir="$GATEWAY_TOOL_ROOT/$CLOUDFLARED_VERSION"
  dir="$(mso_private_state_dir "$dir")" || gateway_fail "unsafe cloudflared tool directory"
  dest="$dir/cloudflared"
  if _gateway_tool_validate "$dest" "$expected"; then CLOUDFLARED="$dest"; return 0; fi
  [ "${MSO_GATEWAY_NO_AUTO_INSTALL:-0}" != 1 ] \
    || gateway_fail "pinned cloudflared $CLOUDFLARED_VERSION is not installed and auto-install is disabled"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    [ -L "$dest" ] && gateway_fail "refusing symlink at pinned cloudflared path: $dest"
    rm -f -- "$dest"
  fi

  gateway_info "installing pinned cloudflared $CLOUDFLARED_VERSION for $(uname -m) (user-local, SHA-256 verified)…"
  tmp="$(mktemp "$dir/.cloudflared.XXXXXX")"; chmod 600 "$tmp"
  if ! "$CURL" --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 -o "$tmp" "$url"; then
    rm -f -- "$tmp"; gateway_fail "could not download pinned cloudflared from the official release"
  fi
  actual="$(sha256sum "$tmp" | awk '{print $1}')"
  if [ "$actual" != "$expected" ]; then
    rm -f -- "$tmp"; gateway_fail "cloudflared SHA-256 mismatch; refusing to execute downloaded artifact"
  fi
  chmod 700 "$tmp"; mv -fT -- "$tmp" "$dest"
  _gateway_tool_validate "$dest" "$expected" || gateway_fail "installed cloudflared failed local identity verification"
  CLOUDFLARED="$dest"
}

gateway_cmd_install_tool() {
  gateway_resolve_cloudflared
  gateway_info "cloudflared: $CLOUDFLARED"
  "$CLOUDFLARED" --version | head -1
}
