#!/usr/bin/env bash
# Shared health checks implementation for machine-readable `mso doctor --json`.
# Bash + jq only; no credentials or secrets leaked into stdout.

doctor_browser_origin_ok() {
  case "$1" in
    https://*) return 0 ;;
    http://127.*:*|http://localhost:*|http://\[::1\]:*) return 0 ;;
    *) return 1 ;;
  esac
}

# Emits checks in TSV format: name <tab> status <tab> detail <tab> fix
doctor_checks() {
  local local_runtime=0
  case "$B" in
    'http://127.'*:*|'http://localhost:'*|'http://[::1]:'*) local_runtime=1 ;;
  esac

  # 1. curl
  if command -v curl >/dev/null 2>&1; then
    printf '%s\t%s\t%s\t%s\n' "curl" "ok" "" ""
  else
    printf '%s\t%s\t%s\t%s\n' "curl" "fail" "" "install curl"
  fi

  # 2. jq
  if command -v jq >/dev/null 2>&1; then
    printf '%s\t%s\t%s\t%s\n' "jq" "ok" "" ""
  else
    printf '%s\t%s\t%s\t%s\n' "jq" "fail" "" "install jq"
  fi

  # 3. node
  if node "${ROOT:-.}/scripts/check-node-runtime.mjs" >/dev/null 2>&1; then
    printf '%s\t%s\t%s\t%s\n' "node" "ok" "" ""
  else
    printf '%s\t%s\t%s\t%s\n' "node" "fail" "" "install Node 22.12+, 24.x or 26+"
  fi

  # 4. env file
  if [ -f "$ENVF" ]; then
    printf '%s\t%s\t%s\t%s\n' "env file" "ok" "" ""
  else
    printf '%s\t%s\t%s\t%s\n' "env file" "fail" "no $ENVF" "copy .env.example and fill it"
  fi

  # 5. login password
  if [ -n "${PASS-}" ]; then
    printf '%s\t%s\t%s\t%s\n' "login password" "ok" "" ""
  else
    printf '%s\t%s\t%s\t%s\n' "login password" "fail" "OS_LOGIN_PASSWORD unset in $ENVF" "OS_LOGIN_PASSWORD unset in $ENVF"
  fi

  # 6. session secret
  if [ -n "${OS_SESSION_SECRET-}" ]; then
    printf '%s\t%s\t%s\t%s\n' "session secret" "ok" "" ""
  else
    printf '%s\t%s\t%s\t%s\n' "session secret" "fail" "OS_SESSION_SECRET unset in $ENVF" "OS_SESSION_SECRET unset in $ENVF"
  fi

  # 7. login transport
  if doctor_browser_origin_ok "$B"; then
    printf '%s\t%s\t%s\t%s\n' "login transport" "ok" "browser must use HTTPS or http://localhost (never plain http://server-ip)" ""
  else
    printf '%s\t%s\t%s\t%s\n' "login transport" "fail" "browser login requires HTTPS or a loopback URL" "use a TLS proxy/gateway, or SSH -L and open http://localhost"
  fi

  # 8. public origin (only when set)
  if [ -n "${OS_PUBLIC_ORIGIN-}" ]; then
    if doctor_browser_origin_ok "$OS_PUBLIC_ORIGIN"; then
      printf '%s\t%s\t%s\t%s\n' "public origin" "ok" "$OS_PUBLIC_ORIGIN" ""
    else
      printf '%s\t%s\t%s\t%s\n' "public origin" "fail" "OS_PUBLIC_ORIGIN=$OS_PUBLIC_ORIGIN is not a valid browser login origin" "use https://..."
    fi
  fi

  # 9. app dashboards
  local tpl="${NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE-}"
  if [ -n "$tpl" ]; then
    printf '%s\t%s\t%s\t%s\n' "app dashboards" "ok" "$tpl — host-only app sessions; REBUILD after changing the template" ""
  else
    printf '%s\t%s\t%s\t%s\n' "app dashboards" "skip" "off: no app host — managed-app windows open on the CLI view" ""
  fi

  # 10. service unit
  if [ "$local_runtime" = 0 ]; then
    printf '%s\t%s\t%s\t%s\n' "service unit" "skip" "skipped: --base is remote" ""
  elif ! service_manager_read show --property=Version --value >/dev/null 2>&1; then
    printf '%s\t%s\t%s\t%s\n' "service unit" "skip" "systemd manager unavailable; runtime health checked below" ""
  elif ! service_manager_read is-active --quiet mso.service 2>/dev/null; then
    printf '%s\t%s\t%s\t%s\n' "service unit" "fail" "mso.service not active" "run: mso doctor --fix or mso service start"
  else
    printf '%s\t%s\t%s\t%s\n' "service unit" "ok" "" ""
  fi

  # 11. reachable
  doctor_health_ok() {
    local direct=()
    [ "$local_runtime" = 0 ] || direct=(--noproxy '*')
    curl "${direct[@]}" -fsS --max-time 5 "$B/api/health" 2>/dev/null \
      | jq -e 'type == "object" and .status == "ok" and .service == "mso"' >/dev/null 2>&1
  }
  if doctor_health_ok; then
    printf '%s\t%s\t%s\t%s\n' "reachable" "ok" "" ""
  else
    printf '%s\t%s\t%s\t%s\n' "reachable" "fail" "no healthy MSO at $B" "for local recovery run: mso web --local --print"
  fi

  # 12. device known
  local d=""
  if command -v cli_device >/dev/null 2>&1 || type cli_device >/dev/null 2>&1; then
    d=$(cli_device 2>/dev/null || true)
  fi
  local device_ready=0
  if [ "$local_runtime" = 0 ]; then
    printf '%s\t%s\t%s\t%s\n' "device known" "skip" "skipped: --base is remote; check it on that host" ""
    device_ready=1
  elif dev_script --is-approved "$d" >/dev/null 2>&1; then
    printf '%s\t%s\t%s\t%s\n' "device known" "ok" "" ""
    device_ready=1
  else
    printf '%s\t%s\t%s\t%s\n' "device known" "fail" "this CLI device is not approved" "run: mso doctor --fix  (or mso device approve $d \"mso cli\")"
  fi

  # 13. session
  fresh_session_check() {
    mso_private_state_remove_file "$JAR" || return 1
    JAR=$(mso_private_state_ensure_file "$JAR") || return 1
    [ "$(jget /api/auth/me 2>/dev/null | jq -r .authenticated 2>/dev/null)" = true ]
  }
  if [ "$device_ready" = 1 ]; then
    if ( fresh_session_check >/dev/null 2>&1 ); then
      printf '%s\t%s\t%s\t%s\n' "session" "ok" "" ""
    else
      printf '%s\t%s\t%s\t%s\n' "session" "fail" "cannot sign in" "verify password, approved device, and browser/CLI origin above"
    fi
  else
    printf '%s\t%s\t%s\t%s\n' "session" "fail" "skipped until the local CLI device is approved" ""
  fi
}

mso_doctor_json() {
  local json
  json=$(doctor_checks | jq -R -s -c --arg base "$B" '
    split("\n") | map(select(length > 0) | split("\t")) |
    map({
      name: .[0],
      status: .[1],
      detail: (if .[2] == "" then null else .[2] end),
      fix: (if .[3] == "" then null else .[3] end)
    }) as $checks |
    ($checks | map(select(.status == "fail")) | length) as $failed |
    {
      ok: ($failed == 0),
      base: $base,
      checks: $checks,
      failed: $failed
    }
  ')
  printf '%s\n' "$json"
  if [ "$(jq -r .ok <<<"$json")" = "true" ]; then
    exit 0
  else
    exit 1
  fi
}
