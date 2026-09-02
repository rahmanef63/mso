#!/usr/bin/env bash
# Files, host inspection, health and doctor commands.
mso_cmd_host() {
  local cmd="$1"; shift || true
case "$cmd" in
  version|--version|-V|-v)
    app_version="$(jq -r '.version // "unknown"' "$ROOT/package.json" 2>/dev/null || printf unknown)"
    build_sha="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || printf unknown)"
    echo "mso CLI $VERSION · app $app_version · build $build_sha  (base $B, root $ROOT)"
    exit 0 ;;

  # ── files ────────────────────────────────────────────────────────────────
  ls)     jget "/api/v1/fs/list?path=$(enc "${1:-~}")" ;;
  cat)    jget "/api/v1/fs/read?path=$(enc "${1:?path}")" | jq -r . ;;
  raw)    reqraw "$B/api/v1/fs/raw?path=$(enc "${1:?path}")"; exit 0 ;;
  share)  reqraw "$B/api/v1/temp-share/$(enc "${1:?temporary link id}")?download=1"; exit 0 ;;
  usage)  jget "/api/v1/fs/usage?path=$(enc "${1:-~}")" ;;
  search) jget "/api/v1/fs/search?q=$(enc "${1:?query}")${2:+&root=$(enc "$2")}" ;;
  write)  jpost "/api/v1/fs/write" "$(jq -n --arg p "${1:?path}" --arg c "${2-}" '{path:$p,content:$c}')" ;;
  mkdir)  jpost "/api/v1/fs/mkdir" "$(jq -n --arg p "${1:?path}" '{path:$p}')" ;;
  rm)     jdel  "/api/v1/fs/delete" "$(jq -n --arg p "${1:?path}" '{path:$p}')" ;;
  mv)     jpost "/api/v1/fs/move" "$(jq -n --arg f "${1:?from}" --arg t "${2:?to}" '{from:$f,to:$t}')" ;;
  cp)     jpost "/api/v1/fs/copy" "$(jq -n --arg f "${1:?from}" --arg t "${2:?to}" '{from:$f,to:$t}')" ;;
  zip)
    base="${1:?base dir}"; shift
    [ $# -gt 0 ] || die "usage: mso zip <baseDir> <name…> > out.zip"
    q="base=$(enc "$base")"; for n in "$@"; do q="$q&n=$(enc "$n")"; done
    reqraw "$B/api/v1/fs/zip?$q"; exit 0 ;;
  upload)
    src="${1:?local file}"; dst="${2:?destination dir on the host}"
    [ -f "$src" ] || die "no such local file: $src"
    req -F "dest=$dst" -F "file=@$src" "$B/api/v1/fs/upload" ;;

  # ── host ─────────────────────────────────────────────────────────────────
  exec)   jpost "/api/v1/exec/run" "$(jq -n --arg c "$*" '{cmd:$c}')" ;;
  stats)  jget "/api/v1/sys/stats" ;;
  ps)     jget "/api/v1/sys/processes" ;;
  units)
    data=$(jget "/api/v1/sys/services")
    if [ -n "${1-}" ]; then
      jq -r --arg q "${1,,}" '.services[] | select(((.unit+" "+.description+" "+.scope+" "+.active+" "+.sub)|ascii_downcase|contains($q))) | "\(.scope):\(.unit)\t\(.active)/\(.sub)\t\(.description)\(if .controllable then " [allowlisted]" else "" end)"' <<<"$data"
    else
      jq -r '.services[] | "\(.scope):\(.unit)\t\(.active)/\(.sub)\t\(.description)\(if .controllable then " [allowlisted]" else "" end)"' <<<"$data"
    fi ;;
  unit)
    sub="${1:-}"; scope="${2:-}"; unit="${3:-}"
    case "$sub" in
      logs) [ -n "$scope" ] && [ -n "$unit" ] || die "usage: mso $U_unit"
            jget "/api/v1/sys/services/logs?scope=$(enc "$scope")&unit=$(enc "$unit")&limit=$(enc "${4:-120}")" | jq -r '.entries[]?' ;;
      start|stop|restart) [ -n "$scope" ] && [ -n "$unit" ] || die "usage: mso $U_unit"
            jpost "/api/v1/sys/services" "$(jq -n --arg s "$scope" --arg u "$unit" --arg a "$sub" '{scope:$s,unit:$u,action:$a}')" ;;
      *) die "usage: mso $U_unit" ;;
    esac ;;
  packages) jget "/api/v1/sys/packages" ;;
  cleanup) if [ "${1-}" = "--run" ]; then jpost "/api/v1/sys/cleanup"; else jget "/api/v1/sys/cleanup"; fi ;;
  status) jget "/api/status" ;;
  health) jget "/api/auth/me" ;;

  # Layer-by-layer, cheapest first, so the FIRST failure names the real cause
  # instead of the symptom three layers up ("login failed" when node is missing).
  doctor)
    fix=0
    case "${1-}" in
      "") ;;
      --fix) fix=1 ;;
      *) die "usage: mso $U_doctor" ;;
    esac
    fails=0
    chk() { if eval "$2" >/dev/null 2>&1; then printf '  ok    %s\n' "$1"; else printf '  FAIL  %s — %s\n' "$1" "$3"; fails=$((fails+1)); fi; }
    fixed() { printf '  FIXED %s\n' "$1"; }
    browser_origin_ok() {
      case "$1" in
        https://*) return 0 ;;
        http://127.*:*|http://localhost:*|http://\[::1\]:*) return 0 ;;
        *) return 1 ;;
      esac
    }
    doctor_label="mso doctor"; [ "$fix" = 1 ] && doctor_label="$doctor_label --fix"
    echo "$doctor_label  (base $B)"
    chk "curl"           "command -v curl"  "install curl"
    chk "jq"             "command -v jq"    "install jq"
    chk "node"           "command -v node"  "install Node >=20.9"
    chk "env file"       "[ -f '$ENVF' ]"   "no $ENVF — copy .env.example and fill it"
    chk "login password" "[ -n '$PASS' ]"   "OS_LOGIN_PASSWORD unset in $ENVF"
    chk "session secret" "[ -n \"\${OS_SESSION_SECRET-}\" ]" "OS_SESSION_SECRET unset in $ENVF"

    # Browser login is stricter than CLI reachability: the session cookie is
    # always Secure. Plain HTTP on a server/LAN IP can answer /api/health and even
    # accept the password, but the browser cannot retain the session. Loopback is
    # the development exception. Never auto-create a public tunnel in --fix.
    if browser_origin_ok "$B"; then
      echo "  ok    login transport — browser must use HTTPS or http://localhost (never plain http://server-ip)"
    else
      printf '  FAIL  login transport — browser login requires HTTPS or a loopback URL; use a TLS proxy/gateway, or SSH -L and open http://localhost\n'
      fails=$((fails+1))
    fi
    if [ -n "${OS_PUBLIC_ORIGIN-}" ] && ! browser_origin_ok "$OS_PUBLIC_ORIGIN"; then
      printf '  FAIL  public origin — OS_PUBLIC_ORIGIN=%s is not a valid browser login origin; use https://...\n' "$OS_PUBLIC_ORIGIN"
      fails=$((fails+1))
    elif [ -n "${OS_PUBLIC_ORIGIN-}" ]; then
      printf '  ok    public origin (%s)\n' "$OS_PUBLIC_ORIGIN"
    fi

    # Not a chk with a pass/fail: serving NO managed-app dashboards is supported.
    tpl="${NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE-}"; dom="${OS_SESSION_COOKIE_DOMAIN-}"
    if [ -n "$tpl" ] && [ -n "$dom" ]; then
      echo "  ok    app dashboards ($tpl) — after changing this, REBUILD and sign in again"
    elif [ -z "$tpl$dom" ]; then
      echo "  --    app dashboards    (off: no app host — managed-app windows open on the CLI view)"
    else
      printf '  FAIL  app dashboards — set BOTH NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE and OS_SESSION_COOKIE_DOMAIN, or neither\n'
      fails=$((fails+1))
    fi

    if ! service_manager_read is-active --quiet mso.service 2>/dev/null; then
      if [ "$fix" = 1 ] && service_manager_read show -p WorkingDirectory --value mso.service 2>/dev/null | grep -q .; then
        if ( service_start_safe >/dev/null 2>&1 ); then fixed "service unit started"; else printf '  FAIL  service unit — automatic start failed; run: mso service logs\n'; fails=$((fails+1)); fi
      else
        printf '  FAIL  service unit — mso.service not active%s\n' "$([ "$fix" = 1 ] && printf '; no existing unit could be safely started' || printf ' — run: mso doctor --fix or mso service start')"
        fails=$((fails+1))
      fi
    else
      echo "  ok    service unit"
    fi
    chk "reachable"      "curl -fsS --max-time 5 '$B/api/health'"  "nothing answering at $B"

    d=$(cli_device); device_ready=0
    case "$B" in
      http://127.0.0.1:*|http://localhost:*|http://[::1]:*)
        if dev_script --is-approved "$d" >/dev/null 2>&1; then
          echo "  ok    device known"; device_ready=1
        elif [ "$fix" = 1 ]; then
          if dev_script "$d" "mso cli" >/dev/null 2>&1; then fixed "local CLI device approved"; device_ready=1
          else printf '  FAIL  device known — could not approve the local CLI device; inspect: mso device list\n'; fails=$((fails+1)); fi
        else
          printf '  FAIL  device known — this CLI device is not approved; run: mso doctor --fix  (or mso device approve %s "mso cli")\n' "$d"
          fails=$((fails+1))
        fi ;;
      *) echo "  --    device known    (skipped: --base is remote; check it on that host)"; device_ready=1 ;;
    esac

    fresh_session_check() {
      mso_private_state_remove_file "$JAR" || return 1
      JAR=$(mso_private_state_ensure_file "$JAR") || return 1
      [ "$(jget /api/auth/me | jq -r .authenticated)" = true ]
    }
    if [ "$device_ready" = 1 ]; then
      if ( fresh_session_check >/dev/null 2>&1 ); then
        [ "$fix" = 1 ] && fixed "session refreshed" || echo "  ok    session"
      else
        printf '  FAIL  session — cannot sign in; verify password, approved device, and browser/CLI origin above\n'
        fails=$((fails+1))
      fi
    else
      printf '  FAIL  session — skipped until the local CLI device is approved\n'
      fails=$((fails+1))
    fi
    echo
    if [ "$fix" = 1 ]; then
      echo "--fix only changes safe local state: existing service start, this host's CLI approval, and its cookie jar."
      echo "It never changes DNS, TLS certificates, firewall rules, public exposure, or credentials."
    fi
    [ "$fails" -eq 0 ] && echo "all good." || echo "$fails check(s) failed."
    exit $(( fails > 0 ? 1 : 0 )) ;;
  *) die "internal CLI routing error: $cmd reached the wrong command family" ;;
esac
}
