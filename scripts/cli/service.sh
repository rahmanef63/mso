#!/usr/bin/env bash
# Gateway/service/update lifecycle helpers. Sourced by scripts/cli/runtime.sh.
gateway_local_url() {
  local port=""
  if [ -n "${MSO_GATEWAY_LOCAL_URL:-}" ]; then
    printf '%s' "$MSO_GATEWAY_LOCAL_URL"
    return
  fi
  case "$B" in
    http://127.*:*|http://localhost:*|http://\[::1\]:*) printf '%s' "$B"; return ;;
  esac
  if command -v systemctl >/dev/null 2>&1; then
    port=$(systemctl show -p Environment --value mso.service 2>/dev/null \
      | tr ' ' '\n' | sed -n 's/^PORT=//p' | head -1)
  fi
  port="${port:-${MSO_PORT:-4005}}"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] || die "invalid MSO gateway port: $port"
  printf 'http://127.0.0.1:%s' "$port"
}

maybe_update_notice() {
  local verb="$1"
  [ -t 2 ] || return 0
  case "$verb" in update|version|--version|-V|-v|help|-h|--help|completion) return 0 ;; esac
  [ -x "$ROOT/scripts/mso-update" ] || return 0
  MSO_UPDATE_ROOT="$ROOT" "$ROOT/scripts/mso-update" notice || true
}
# shellcheck source=scripts/lib/private-state.sh
. "$ROOT/scripts/lib/private-state.sh"
# shellcheck source=scripts/lib/runtime-exclusion.sh
. "$ROOT/scripts/lib/runtime-exclusion.sh"

service_manager_read() {
  local manager="${MSO_SYSTEMCTL_BIN:-systemctl}"
  "$manager" "$@"
}

service_manager_write() {
  if [ -n "${MSO_SYSTEMCTL_BIN:-}" ]; then "$MSO_SYSTEMCTL_BIN" "$@";
  else sudo systemctl "$@"; fi
}

require_service_checkout_cli() {
  local configured canonical_root canonical_service
  configured="$(service_manager_read show -p WorkingDirectory --value mso.service 2>/dev/null || true)"
  [ -n "$configured" ] || die "mso.service has no readable WorkingDirectory; refusing lifecycle action"
  canonical_root="$(realpath -e -- "$ROOT" 2>/dev/null || true)"
  canonical_service="$(realpath -e -- "$configured" 2>/dev/null || true)"
  [ -n "$canonical_root" ] && [ -n "$canonical_service" ] \
    || die "cannot canonicalize mso.service WorkingDirectory"
  [ "$canonical_service" = "$canonical_root" ] \
    || die "mso.service belongs to $canonical_service, not this checkout $canonical_root"
}

service_unit_local_url() {
  local raw port
  raw="$(service_manager_read show -p Environment --value mso.service 2>/dev/null || true)"
  port="$(printf '%s\n' "$raw" | tr ' ' '\n' | sed -n 's/^PORT=//p' | head -1)"
  if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then port=4005; fi
  printf 'http://127.0.0.1:%s' "$port"
}

service_wait_ready() {
  local local_url="$1" attempts="${MSO_SERVICE_READY_ATTEMPTS:-40}" expected_version body i curl_bin="${MSO_CURL_BIN:-curl}"
  [[ "$attempts" =~ ^[0-9]+$ ]] && [ "$attempts" -ge 1 ] && [ "$attempts" -le 120 ] || attempts=40
  expected_version="$(jq -r '.version // empty' "$ROOT/package.json" 2>/dev/null || true)"
  [ -n "$expected_version" ] || return 1
  for ((i = 1; i <= attempts; i++)); do
    body="$("$curl_bin" --noproxy '*' -fsS --connect-timeout 1 --max-time 2 "$local_url/api/health" 2>/dev/null || true)"
    if jq -e --arg version "$expected_version" '
      type == "object" and .status == "ok" and .service == "mso" and
      (.buildId | type == "string" and length > 0) and
      (.buildSha | type == "string" and test("^[0-9a-f]{7,40}$")) and
      .version == $version and has("runtimeInstanceId")
    ' <<<"$body" >/dev/null 2>&1; then
      return 0
    fi
    [ "$i" -ge "$attempts" ] || sleep 0.25
  done
  return 1
}

service_handoff_marker() {
  local canonical base key dir
  canonical="$(realpath -e -- "$ROOT" 2>/dev/null || true)"
  [ -n "$canonical" ] || die "cannot canonicalize checkout for service handoff"
  base="$(mso_private_state_dir "${MSO_SERVICE_HANDOFF_DIR:-$HOME/.mso/private/service-handoff}")" \
    || die "unsafe service handoff state directory"
  key="$(printf '%s' "$canonical" | sha256sum | awk '{print $1}')"
  [[ "$key" =~ ^[0-9a-f]{64}$ ]] || die "cannot derive service handoff scope"
  dir="$(mso_private_state_dir "$base/$key")" || die "unsafe scoped service handoff directory"
  printf '%s/runtime' "$dir"
}

service_handoff_fallback_locked() {
  local gateway local_url marker probe out
  SERVICE_FALLBACK_QUIESCED=0
  gateway="${MSO_GATEWAY_BIN:-$ROOT/scripts/mso-gateway}"
  [ -x "$gateway" ] || die "missing gateway lifecycle helper: $gateway"
  local_url="$(service_unit_local_url)"; marker="$(service_handoff_marker)"
  probe="$(MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ENVF" MSO_GATEWAY_LOCAL_URL="$local_url" \
    "$gateway" runtime-assert-update-safe 2>&1)" || die "cannot hand off service port $local_url: $probe"
  case "$probe" in
    *'runtime: update-owned'*)
      out="$(MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ENVF" MSO_GATEWAY_LOCAL_URL="$local_url" \
        MSO_GATEWAY_RECOVERY_MARKER="$marker" "$gateway" runtime-stop 2>&1)" \
        || die "could not quiesce gateway-owned fallback at $local_url: $out"
      case "$out" in
        *'runtime: stopped-owned'*|*'runtime: recovered-stale-owned'*|*'runtime: already-down'*) SERVICE_FALLBACK_QUIESCED=1 ;;
        *) die "unexpected fallback handoff result at $local_url: $out" ;;
      esac ;;
    *'runtime: update-safe'*) ;;
    *) die "unexpected service handoff probe at $local_url: $probe" ;;
  esac
  SERVICE_HANDOFF_URL="$local_url"; SERVICE_HANDOFF_MARKER="$marker"
}

service_restore_fallback_after_failure() {
  local gateway="${MSO_GATEWAY_BIN:-$ROOT/scripts/mso-gateway}"
  [ "${SERVICE_FALLBACK_QUIESCED:-0}" = 1 ] || return 0
  if ! MSO_GATEWAY_ROOT="$ROOT" MSO_GATEWAY_ENV="$ENVF" MSO_GATEWAY_LOCAL_URL="$SERVICE_HANDOFF_URL" \
    "$gateway" local-start >/dev/null 2>&1; then
    printf 'mso: service action failed and fallback restore also failed at %s; recovery marker preserved\n' "$SERVICE_HANDOFF_URL" >&2
    return 1
  fi
  mso_private_state_remove_file "$SERVICE_HANDOFF_MARKER" >/dev/null 2>&1 \
    || { printf 'mso: fallback restored but recovery marker could not be cleared\n' >&2; return 1; }
}

service_lifecycle_safe() {
  local verb="$1" rc=0 active=0
  require_service_checkout_cli
  runtime_exclusion_acquire_shared \
    || die "offline update/deploy is mutating this checkout or another service handoff is active; retry after it finishes"
  service_manager_read is-active --quiet mso.service && active=1 || true
  SERVICE_FALLBACK_QUIESCED=0; SERVICE_HANDOFF_URL=''; SERVICE_HANDOFF_MARKER=''
  [ "$active" = 1 ] || service_handoff_fallback_locked
  service_manager_write "$verb" mso.service || rc=$?
  if [ "$rc" -eq 0 ] && ! service_wait_ready "$(service_unit_local_url)"; then
    printf 'mso: service %s returned success but /api/health did not become ready; restoring fallback if available\n' "$verb" >&2
    rc=24
    # A Type=simple unit can report a successful start before Next later fails.
    # Stop any unhealthy survivor so the quiesced fallback can reclaim its port.
    service_manager_write stop mso.service >/dev/null 2>&1 || true
  fi
  runtime_exclusion_release
  if [ "$rc" -ne 0 ]; then
    service_restore_fallback_after_failure || return 1
    return "$rc"
  fi
  [ -z "${SERVICE_HANDOFF_MARKER:-}" ] || mso_private_state_remove_file "$SERVICE_HANDOFF_MARKER" >/dev/null 2>&1 || true
}

service_start_safe() { service_lifecycle_safe start; }
service_restart_safe() { service_lifecycle_safe restart; }

deploy_safe() {
  local local_url helper
  require_service_checkout_cli
  service_manager_read is-active --quiet mso.service \
    || die "mso.service is not active; start the intended service first, then run mso deploy"
  local_url="$(gateway_local_url)"
  # The outer helper owns checkout-wide runtime inventory/quiesce/restore around
  # the in-place build, so deploy never mutates `.next` under a fallback runtime.
  helper="${MSO_SERVICE_UPDATE_BIN:-$ROOT/scripts/mso-service-update}"
  [ -x "$helper" ] || [ -f "$helper" ] || die "missing service deployment helper: $helper"
  MSO_UPDATE_ROOT="$ROOT" MSO_UPDATE_LOCAL_URL="$local_url" /bin/bash "$helper" --rebuild-only
  echo "deployed → $B"
}
