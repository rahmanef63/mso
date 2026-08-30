#!/usr/bin/env bash
# Shared validation, process identity, locking, and health checks for mso-gateway.

gateway_fail() { printf 'mso gateway: %s\n' "$*" >&2; exit 1; }
gateway_info() { printf '%s\n' "$*"; }

gateway_validate_loopback_origin() {
  node - "$1" <<'NODE'
const raw = process.argv[2];
try {
  const u = new URL(raw), host = u.hostname.toLowerCase(), parts = host.split('.');
  const v4 = parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
  const loopback = host === 'localhost' || host === '[::1]' || host === '::1' || v4;
  const clean = u.protocol === 'http:' && loopback && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash;
  if (!clean || !u.port) process.exit(1);
  process.stdout.write(u.origin);
} catch { process.exit(1); }
NODE
}

gateway_validate_public_origin() {
  node - "$1" <<'NODE'
const raw = process.argv[2];
try {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) process.exit(1);
  process.stdout.write(u.origin);
} catch { process.exit(1); }
NODE
}

gateway_loopback_host_port() {
  node - "$LOCAL_URL" <<'NODE'
const u = new URL(process.argv[2]);
process.stdout.write(`${u.hostname.replace(/^\[|\]$/g, '')}\t${u.port}\n`);
NODE
}

gateway_private_file() {
  mso_private_state_ensure_file "$1" >/dev/null || gateway_fail "unsafe private state file: $1"
}

gateway_state_read() {
  if [ -e "$STATE_FILE" ] || [ -L "$STATE_FILE" ]; then
    if ! mso_private_state_validate_file "$STATE_FILE" >/dev/null; then
      printf 'mso gateway: unsafe gateway state file\n' >&2; return 2
    fi
    if [ ! -s "$STATE_FILE" ]; then
      printf 'mso gateway: gateway state is empty; inspect %s before removing it\n' "$STATE_FILE" >&2; return 2
    fi
    if ! jq -e . "$STATE_FILE" 2>/dev/null; then
      printf 'mso gateway: gateway state is corrupt; inspect %s before removing it\n' "$STATE_FILE" >&2; return 2
    fi
  else
    printf '{}\n'
  fi
}

gateway_pid_alive() { [ "${1:-0}" -gt 1 ] 2>/dev/null && kill -0 "$1" 2>/dev/null; }

gateway_proc_start_ticks() {
  local pid="$1" line rest
  gateway_pid_alive "$pid" || return 1
  IFS= read -r line <"/proc/$pid/stat" || return 1
  rest="${line##*) }"
  set -- $rest
  [ "$#" -ge 20 ] || return 1
  printf '%s' "${20}"
}

gateway_capture_identity() {
  local pid="$1" first second exe hash i
  for i in 1 2 3 4; do
    first="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
    [ -n "$first" ] || return 1
    exe="$(readlink -f -- "/proc/$pid/exe" 2>/dev/null || true)"
    hash="$(sha256sum "/proc/$pid/cmdline" 2>/dev/null | awk '{print $1}' || true)"
    second="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
    if [ -n "$exe" ] && [ -n "$hash" ] && [ "$first" = "$second" ]; then
      jq -nc --argjson pid "$pid" --arg start "$first" --arg exe "$exe" --arg cmdHash "$hash" \
        '{pid:$pid,startTicks:$start,exe:$exe,cmdHash:$cmdHash}'
      return 0
    fi
    sleep 0.02
  done
  return 1
}

gateway_identity_matches() {
  local expected="$1" pid current
  pid="$(jq -r '.pid // 0' <<<"$expected" 2>/dev/null || printf 0)"
  [ "$pid" -gt 1 ] 2>/dev/null || return 1
  current="$(gateway_capture_identity "$pid" 2>/dev/null || true)"
  [ -n "$current" ] || return 1
  jq -e --argjson current "$current" '
    .pid == $current.pid and .startTicks == $current.startTicks and .exe == $current.exe and
    (((.cmdHash // null) == null) or .cmdHash == $current.cmdHash)
  ' <<<"$expected" >/dev/null 2>&1
}

gateway_identity_matches_retry() {
  local expected="$1" attempts="${2:-4}" pid i
  pid="$(jq -r '.pid // 0' <<<"$expected" 2>/dev/null || printf 0)"
  [ "$pid" -gt 1 ] 2>/dev/null || return 1
  for i in $(seq 1 "$attempts"); do
    gateway_identity_matches "$expected" && return 0
    gateway_pid_alive "$pid" || return 1
    sleep 0.03
  done
  return 1
}

gateway_command_matches() {
  local pid="$1" marker="$2" i j; shift 2
  local -a argv expected=("$@")
  gateway_pid_alive "$pid" || return 1
  mapfile -d '' -t argv <"/proc/$pid/cmdline" 2>/dev/null || return 1
  for ((i=0; i<${#argv[@]}; i++)); do
    [ "${argv[$i]}" = "$marker" ] || continue
    [ "$(( ${#argv[@]} - i - 1 ))" -eq "${#expected[@]}" ] || return 1
    for ((j=0; j<${#expected[@]}; j++)); do
      [ "${argv[$((i+j+1))]}" = "${expected[$j]}" ] || return 1
    done
    return 0
  done
  return 1
}

gateway_wait_spawn_identity() {
  local pid="$1" marker="$2" i identity; shift 2
  for i in $(seq 1 50); do
    if gateway_command_matches "$pid" "$marker" "$@"; then
      identity="$(gateway_capture_identity "$pid" 2>/dev/null || true)"
      [ -n "$identity" ] && { printf '%s' "$identity"; return 0; }
    fi
    gateway_pid_alive "$pid" || return 1
    sleep 0.05
  done
  return 1
}

gateway_stop_identity() {
  local identity="$1" pid i
  pid="$(jq -r '.pid // 0' <<<"$identity" 2>/dev/null || printf 0)"
  gateway_identity_matches "$identity" || return 0
  kill "$pid" 2>/dev/null || true
  for i in $(seq 1 25); do
    gateway_identity_matches "$identity" || return 0
    sleep 0.1
  done
  gateway_identity_matches "$identity" && kill -KILL "$pid" 2>/dev/null || true
}

gateway_health_body_ok() {
  local body="$1" expected_instance="${2-}"
  [ -n "$body" ] || return 1
  jq -e --arg version "$GATEWAY_EXPECTED_VERSION" --arg instance "$expected_instance" '
    type == "object" and .status == "ok" and .version == $version and
    (.buildId | type == "string") and (.buildId | length > 0) and
    (if $instance == "" then has("runtimeInstanceId") else .runtimeInstanceId == $instance end)
  ' <<<"$body" >/dev/null 2>&1
}

gateway_health_url_ok() {
  local base="$1" expected_instance="${2-}" body loopback
  local -a curl_args=(-fsS --max-time 4)
  loopback="$(gateway_validate_loopback_origin "$base" 2>/dev/null || true)"
  # A user's http_proxy/HTTP_PROXY must never redirect the trusted local-health
  # decision through a proxy. Public HTTPS probes retain ordinary proxy behavior.
  [ -z "$loopback" ] || curl_args+=(--noproxy '*')
  body="$("$CURL" "${curl_args[@]}" "$base/api/health" 2>/dev/null || true)"
  gateway_health_body_ok "$body" "$expected_instance"
}

gateway_health_ok() { gateway_health_url_ok "$LOCAL_URL"; }

gateway_wait_health() {
  local expected_instance="${1-}" i
  for i in $(seq 1 40); do gateway_health_url_ok "$LOCAL_URL" "$expected_instance" && return 0; sleep 0.25; done
  return 1
}
