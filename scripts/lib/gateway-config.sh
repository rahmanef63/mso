#!/usr/bin/env bash
# Stable-origin configuration, diagnostics, and browser launcher.

gateway_safe_env_file() {
  local mode
  [ -e "$ENVF" ] || gateway_fail "env file not found: $ENVF"
  [ -f "$ENVF" ] && [ ! -L "$ENVF" ] || gateway_fail "env file must be a regular non-symlink file"
  [ "$(stat -c '%u' "$ENVF")" = "$(id -u)" ] || gateway_fail "env file must be owned by current user"
  mode="$(stat -c '%a' "$ENVF")"; (( (8#$mode & 077) == 0 )) \
    || gateway_fail "env file contains secrets and must not be group/world-accessible (got mode $mode)"
}

gateway_env_origin() {
  gateway_safe_env_file
  sed -n 's/^OS_PUBLIC_ORIGIN=//p' "$ENVF" | tail -1
}

gateway_rewrite_env_origin() {
  local action="$1" value="${2-}"
  gateway_safe_env_file
  node - "$ENVF" "$action" "$value" <<'NODE'
const fs = require('fs');
const [file, action, value] = process.argv.slice(2);
const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
let st, text;
try { st = fs.fstatSync(fd); text = fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); }
if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) process.exit(2);
if (action === 'set') {
  const line = `OS_PUBLIC_ORIGIN=${value}`;
  text = /^OS_PUBLIC_ORIGIN=.*$/m.test(text) ? text.replace(/^OS_PUBLIC_ORIGIN=.*$/m, line)
    : text + `${text.endsWith('\n') || !text ? '' : '\n'}${line}\n`;
} else if (action === 'clear') text = text.replace(/^OS_PUBLIC_ORIGIN=.*\n?/gm, '');
else process.exit(2);
const tmp = `${file}.mso-gateway-${process.pid}`;
const out = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, st.mode & 0o777);
try { fs.writeFileSync(out, text); fs.fsyncSync(out); } finally { fs.closeSync(out); }
fs.renameSync(tmp, file);
NODE
}

gateway_cmd_domain() {
  local sub="${1:-show}" origin domain_host
  case "$sub" in
    show) origin="$(gateway_env_origin)"; [ -n "$origin" ] && gateway_info "$origin" || gateway_info "OS_PUBLIC_ORIGIN is not set" ;;
    set)
      [ -n "${2-}" ] || gateway_fail "usage: mso gateway domain set https://mso.example.com"
      origin="$(gateway_validate_public_origin "$2" 2>/dev/null || true)"
      [ -n "$origin" ] || gateway_fail "public origin must be a clean HTTPS origin"
      gateway_rewrite_env_origin set "$origin"; domain_host="${origin#https://}"
      gateway_info "saved OS_PUBLIC_ORIGIN=$origin in $ENVF"
      gateway_info "MSO still binds only to $LOCAL_URL"
      cat <<CFG
named Cloudflare config example:
  tunnel: <TUNNEL-UUID>
  credentials-file: $HOME/.cloudflared/<TUNNEL-UUID>.json
  ingress:
    - hostname: $domain_host
      service: $LOCAL_URL
    - service: http_status:404
then: cloudflared tunnel route dns <TUNNEL-UUID-or-name> $domain_host
and:  mso gateway start --config ~/.cloudflared/config.yml --tunnel <TUNNEL-UUID-or-name>
CFG
      gateway_info "rebuild/restart MSO after stable origin or split-host env changes" ;;
    clear) gateway_rewrite_env_origin clear; gateway_info "removed OS_PUBLIC_ORIGIN" ;;
    *) gateway_fail "usage: mso gateway domain show|set <https://host>|clear" ;;
  esac
}

gateway_cmd_doctor() {
  local fails=0 origin
  gateway_info "mso gateway doctor"
  gateway_health_ok && gateway_info "  ok    verified MSO runtime $LOCAL_URL" \
    || gateway_info "  --    no verified MSO runtime (mso web can start the built loopback fallback)"
  if MSO_GATEWAY_NO_AUTO_INSTALL=1 gateway_resolve_cloudflared >/dev/null 2>&1; then
    gateway_info "  ok    $("$CLOUDFLARED" --version 2>/dev/null | head -1) (pinned/explicit)"
  else gateway_info "  FAIL  cloudflared unavailable — run: mso gateway install"; fails=$((fails+1)); fi
  if gateway_port_exposure_state; then
    gateway_info "  FAIL  raw MSO port has a non-loopback listener — reconfigure it to 127.0.0.1 before public tunneling"; fails=$((fails+1))
  else
    rc=$?
    if [ "$rc" = 1 ]; then gateway_info "  ok    raw MSO port has no non-loopback listener"
    else gateway_info "  FAIL  cannot verify kernel listener exposure"; fails=$((fails+1)); fi
  fi
  gateway_info "  ok    gateway upstream policy is loopback-only"
  origin="$(gateway_env_origin 2>/dev/null || true)"
  [ -n "$origin" ] && gateway_info "  ok    stable public origin: $origin" || gateway_info "  --    no stable public origin (temporary mode available)"
  local active_rc
  if gateway_active_state >/dev/null; then gateway_info "  ok    public gateway running"
  else active_rc=$?; if [ "$active_rc" = 1 ]; then gateway_info "  --    public gateway stopped"
    else gateway_info "  FAIL  gateway state is unsafe/corrupt"; fails=$((fails+1)); fi; fi
  return "$fails"
}

gateway_cmd_web_resolve_locked() {
  local mode="$1" state rc
  case "$mode" in
    public|auto)
      if state="$(gateway_active_state)"; then
        # The lifecycle decision and reconciliation share the SAME exclusive lock.
        # Only the checkout-wide runtime lock nests inside it while Next may start.
        gateway_with_runtime_shared gateway_reconcile_active_tunnel "$state" >/dev/null
        state="$(gateway_active_state)" || gateway_fail "public gateway stopped during reconciliation"
        jq -r .url <<<"$state"
        return 0
      else rc=$?; fi
      [ "$rc" = 1 ] || return "$rc"
      if [ "$mode" = public ]; then
        gateway_fail "public gateway is not running; run: mso gateway start"
      fi
      gateway_with_runtime_shared gateway_cmd_local_start_locked >/dev/null
      printf '%s\n' "$LOCAL_URL"
      ;;
    local)
      gateway_with_runtime_shared gateway_cmd_local_start_locked >/dev/null
      printf '%s\n' "$LOCAL_URL"
      ;;
  esac
}

gateway_cmd_web() {
  local mode=auto print_only=0 url opener
  shift || true
  while [ $# -gt 0 ]; do
    case "$1" in --local) mode=local ;; --public) mode=public ;; --print) print_only=1 ;;
      *) gateway_fail "usage: mso web [--local|--public] [--print]" ;; esac
    shift
  done
  url="$(gateway_with_lock gateway_cmd_web_resolve_locked "$mode")"
  case "$url" in http:*) url="$(gateway_validate_loopback_origin "$url" 2>/dev/null || true)" ;;
    https:*) url="$(gateway_validate_public_origin "$url" 2>/dev/null || true)" ;; *) url="" ;; esac
  [ -n "$url" ] || gateway_fail "refusing unsafe browser URL"
  [ "$print_only" = 1 ] && { printf '%s\n' "$url"; return; }
  if command -v wslview >/dev/null 2>&1; then opener=wslview
  elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile -NonInteractive -Command 'Start-Process $args[0]' "$url" >/dev/null 2>&1 & gateway_info "opened $url"; return
  elif command -v xdg-open >/dev/null 2>&1; then opener=xdg-open
  elif command -v open >/dev/null 2>&1; then opener=open
  else gateway_info "$url"; gateway_info "no browser opener found; open the URL above"; return; fi
  "$opener" "$url" >/dev/null 2>&1 & gateway_info "opened $url"
}
