#!/usr/bin/env bash
# Stable-origin configuration, diagnostics, and browser launcher.

gateway_safe_env_file() {
  local mode mode_decimal
  [ -e "$ENVF" ] || gateway_fail "env file not found: $ENVF"
  [ -f "$ENVF" ] && [ ! -L "$ENVF" ] || gateway_fail "env file must be a regular non-symlink file"
  [ "$(stat -c '%u' "$ENVF")" = "$(id -u)" ] || gateway_fail "env file must be owned by current user"
  # Convert validated octal stat output before applying the permission mask.
  mode="$(stat -c '%a' "$ENVF")"; [[ "$mode" =~ ^[0-7]{1,4}$ ]] && mode_decimal="$(printf '%d' "0$mode")" && [ "$((mode_decimal & 63))" -eq 0 ] \
    || gateway_fail "env file contains secrets and must not be group/world-accessible (got mode $mode)"
}

gateway_env_identity() {
  local canonical dev ino
  # Missing/default env and explicit /dev/null are the same runtime contract: no
  # file is sourced. Persist /dev/null so a later restore cannot accidentally pick
  # up a newly-created .env.local with different credentials.
  if [ "$ENVF" = /dev/null ] || { [ ! -e "$ENVF" ] && [ ! -L "$ENVF" ]; }; then
    jq -nc '{path:"/dev/null",dev:null,ino:null}'
    return 0
  fi
  gateway_safe_env_file
  canonical="$(realpath -e -- "$ENVF" 2>/dev/null || true)"
  [ -n "$canonical" ] || gateway_fail "cannot canonicalize env file: $ENVF"
  dev="$(stat -c '%d' -- "$ENVF")"; ino="$(stat -c '%i' -- "$ENVF")"
  [[ "$dev" =~ ^[0-9]+$ && "$ino" =~ ^[0-9]+$ ]] || gateway_fail "cannot identify env file: $ENVF"
  jq -nc --arg path "$canonical" --arg dev "$dev" --arg ino "$ino" '{path:$path,dev:$dev,ino:$ino}'
}

gateway_assert_expected_env_identity() {
  local current="$1" expected="${MSO_GATEWAY_EXPECT_ENV_IDENTITY:-}"
  [ -n "$expected" ] || return 0
  jq -e 'type=="object" and (.path|type=="string") and
    ((.path=="/dev/null" and .dev==null and .ino==null) or
     ((.path|startswith("/")) and .path!="/dev/null" and
      (.dev|type=="string" and test("^[0-9]+$")) and (.ino|type=="string" and test("^[0-9]+$"))))' <<<"$expected" >/dev/null 2>&1 \
    || gateway_fail "invalid expected env-file identity"
  [ "$(jq -cS . <<<"$current")" = "$(jq -cS . <<<"$expected")" ] \
    || gateway_fail "env file identity changed while runtime was quiesced; restore state was preserved"
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
  text = text.replace(/^OS_PUBLIC_ORIGIN=.*\n?/gm, '');
  text += `${text.endsWith('\n') || !text ? '' : '\n'}${line}\n`;
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
  local fails=0 observed rc state provider public_health local_health ownership public
  gateway_info "mso gateway doctor"
  if observed="$(gateway_observe_state)"; then rc=0; else rc=$?; fi
  if [ "$rc" != 0 ]; then
    gateway_info "  FAIL  gateway state is unsafe/corrupt"
    fails=$((fails+1))
  fi
  local_health="$(jq -r '.localHealth // "unknown"' <<<"$observed")"
  if [ "$local_health" = healthy ]; then gateway_info "  ok    verified MSO runtime (local) $LOCAL_URL"
  else gateway_info "  warn  no verified MSO runtime at $LOCAL_URL (local)"; fi

  if gateway_port_exposure_state; then
    gateway_info "  FAIL  local binding security: raw MSO port has a non-loopback listener"
    fails=$((fails+1))
  else
    rc=$?
    if [ "$rc" = 1 ]; then gateway_info "  ok    local binding security: raw MSO port has no non-loopback listener"
    else gateway_info "  FAIL  local binding security: cannot verify kernel listener exposure"; fails=$((fails+1)); fi
  fi
  gateway_info "  ok    gateway upstream policy is loopback-only"

  public="$(jq -r '.public // empty' <<<"$observed")"
  public_health="$(jq -r '.publicHealth // "unknown"' <<<"$observed")"
  if [ -n "$public" ]; then gateway_info "  info  configured public origin: $public"
  else gateway_info "  info  no configured stable public origin"; fi
  case "$public_health" in
    healthy) gateway_info "  ok    public MSO identity matches local runtime" ;;
    identity-mismatch) gateway_info "  FAIL  public route reaches a different MSO identity"; fails=$((fails+1)) ;;
    failing) gateway_info "  FAIL  public route unreachable"; fails=$((fails+1)) ;;
    invalid) gateway_info "  FAIL  public route does not return the MSO health contract"; fails=$((fails+1)) ;;
    unverified) gateway_info "  warn  public MSO responder exists but local identity is unavailable for comparison" ;;
    not-configured) gateway_info "  info  public health not configured" ;;
    *) gateway_info "  warn  public health is unknown" ;;
  esac

  state="$(jq -r '.state // "unknown"' <<<"$observed")"
  ownership="$(jq -r '.ownership // "unknown"' <<<"$observed")"
  case "$state" in
    managed-running) gateway_info "  ok    gateway lifecycle managed by MSO" ;;
    external-running) gateway_info "  warn  gateway lifecycle managed externally; MSO will not stop/restart/adopt it" ;;
    degraded) gateway_info "  FAIL  gateway is degraded (ownership: $ownership)"; fails=$((fails+1)) ;;
    recovering) gateway_info "  warn  recorded MSO-owned provider process is stale/recovering; no mutation performed" ;;
    stopped) gateway_info "  info  no verified public gateway is running" ;;
    *) gateway_info "  FAIL  gateway lifecycle state is unknown"; fails=$((fails+1)) ;;
  esac
  gateway_info "  info  supervisor: $(jq -r '.supervisor // "unknown"' <<<"$observed")"
  provider="$(jq -r '.provider // "custom"' <<<"$observed")"
  gateway_provider_doctor_readonly "$provider"
  return "$fails"
}

gateway_cmd_web_resolve_locked() {
  local mode="$1" state rc
  case "$mode" in
    public|auto)
      # Existing MSO-owned lifecycle remains authoritative and is checked first.
      # This preserves lock/race behavior without adding public probes to the hot path.
      if state="$(gateway_active_state)"; then
        gateway_with_runtime_shared gateway_reconcile_active_tunnel "$state" >/dev/null
        state="$(gateway_active_state)" || gateway_fail "public gateway stopped during reconciliation"
        jq -r .url <<<"$state"
        return 0
      else rc=$?; fi
      [ "$rc" = 1 ] || return "$rc"

      if [ "$mode" = public ]; then
        local observed observed_state external_url
        observed="$(gateway_observe_state 2>/dev/null || true)"
        observed_state="$(jq -r '.state // empty' <<<"$observed" 2>/dev/null || true)"
        if [ "$observed_state" = external-running ]; then
          external_url="$(jq -r '.public // empty' <<<"$observed")"
          [ -n "$external_url" ] || gateway_fail "external gateway has no valid public origin"
          printf '%s\n' "$external_url"
          return 0
        fi
        gateway_fail "public gateway is not running; run: mso gateway start"
      fi

      # Auto mode deliberately stays local unless MSO itself owns the public
      # lifecycle. Merely configuring an external origin does not change defaults.
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
    case "$1" in
      --local) mode=local ;;
      --public) mode=public ;;
      --print) print_only=1 ;;
      *) gateway_fail "usage: mso web [--local|--public] [--print]" ;;
    esac
    shift
  done
  url="$(gateway_with_lock gateway_cmd_web_resolve_locked "$mode")"
  case "$url" in
    http:*) url="$(gateway_validate_loopback_origin "$url" 2>/dev/null || true)" ;;
    https:*) url="$(gateway_validate_public_origin "$url" 2>/dev/null || true)" ;;
    *) url="" ;;
  esac
  [ -n "$url" ] || gateway_fail "refusing unsafe browser URL"
  [ "$print_only" = 1 ] && { printf '%s\n' "$url"; return; }
  if command -v wslview >/dev/null 2>&1; then opener=wslview
  elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile -NonInteractive -Command 'Start-Process $args[0]' "$url" >/dev/null 2>&1 & gateway_info "opened $url"; return
  elif command -v xdg-open >/dev/null 2>&1; then opener=xdg-open
  elif command -v open >/dev/null 2>&1; then opener=open
  else gateway_info "$url"; gateway_info "no browser opener found; open the URL above"; return; fi
  "$opener" "$url" >/dev/null 2>&1 & gateway_info "opened $url"
}
