#!/usr/bin/env bash
# Devices, OAuth/MCP/audit, service/update, CRUD and escape-hatch commands.
mso_cmd_admin() {
  local cmd="$1"; shift || true
case "$cmd" in
  # ── devices (local file, works even when the service is down) ────────────
  # Both shapes work: `mso devices` reads as a noun, `mso device list` matches the
  # subcommand-group habit every other area here uses (mapp/term/camoufox/service).
  devices|device)
    case "${1:-list}" in
      list)    dev_script --list ;;
      pending) dev_script --pending ;;
      approve) [ -n "${2-}" ] || die "usage: mso device approve <deviceId> [label] [--role viewer|operator|owner]"
               dev_script "$2" "${@:3}" ;;
      role)    [ -n "${2-}" ] && [ -n "${3-}" ] || die "usage: mso device role <deviceId> <viewer|operator|owner>"
               dev_script --set-role "$2" "$3" ;;
      revoke)  [ -n "${2-}" ] || die "usage: mso device revoke <deviceId> | all --yes"
               if [ "$2" = "all" ]; then dev_script --revoke-all "${3-}"
               else dev_script --revoke "$2"; fi ;;
      *) die "usage: mso $U_device" ;;
    esac ;;
  approve) [ -n "${1-}" ] || die "usage: mso approve <deviceId> [label] [--role viewer|operator|owner]  (ids: mso device list)"
           dev_script "$1" "${@:2}" ;;
  revoke)  [ -n "${1-}" ] || die "usage: mso revoke <deviceId>  (ids: mso device list)"
           dev_script --revoke "$1" ;;
  # ── provider OAuth (device-code, NOT a browser redirect) ─────────────────
  oauth)
    p="${1:?provider (e.g. openai)}"; sub="${2:-start}"
    case "$sub" in
      start|poll) jpost "/api/oauth/$(enc "$p")" "$(jq -n --arg a "$sub" '{action:$a}')" ;;
      *) die "usage: mso $U_oauth" ;;
    esac ;;

  # ── MCP tokens (the bearers that let ChatGPT et al. drive this host) ─────
  mcp)
    case "${1:-list}" in
      list)     jget "/api/mcp/tokens" ;;
      activity) jget "/api/mcp/activity?limit=${2:-80}" ;;
      revoke) [ -n "${2-}" ] || die "usage: mso mcp revoke <id|all>   (ids: mso mcp list)"
              jdel "/api/mcp/tokens?id=$(enc "$2")" ;;
      *) die "usage: mso $U_mcp" ;;
    esac ;;

  # ── audit trail (the forensic record; MCP writes land here too) ──────────
  audit)
    q="limit=${1:-50}"; [ -n "${2-}" ] && q="$q&prefix=$(enc "$2")"
    jget "/api/v1/sys/audit?$q" ;;

  whoami)  echo "cli device: $(cli_device)"; jget "/api/auth/me" ;;
  login)   mso_private_state_remove_file "$JAR" || die "refusing unsafe cookie jar: $JAR"
           JAR=$(mso_private_state_ensure_file "$JAR") || die "refusing unsafe cookie jar: $JAR"
           login; echo "logged in as device $(cli_device)" ;;
  logout)  if [ -s "$JAR" ]; then jpost "/api/auth/logout" >/dev/null 2>&1 || true; fi
           mso_private_state_remove_file "$JAR" || die "refusing unsafe cookie jar: $JAR"
           echo "signed out (jar cleared)" ;;

  # ── service (local systemd) ──────────────────────────────────────────────
  service)
    case "${1:-status}" in
      status)  systemctl status --no-pager mso.service ;;
      start)   service_start_safe ;;
      stop)    sudo systemctl stop mso.service ;;
      restart) service_restart_safe ;;
      logs)    journalctl -u mso.service -n "${2:-50}" --no-pager ;;
      *) die "usage: mso $U_service" ;;
    esac ;;
  # NOT `next build` — this is mso.service's WorkingDirectory, and a build here
  # deletes .next under the running process, 404ing every chunk until a restart.
  # verify-build.sh compiles HEAD in a temp dir instead. `deploy` uses the same
  # checkout-wide quiesce/build/restart/restore lifecycle as service self-update.
  build)  (cd "$ROOT" && bash scripts/verify-build.sh) ;;
  deploy) deploy_safe ;;
  # The same self-update Settings → About drives, so both surfaces get the same
  # preflight and the same transient-unit handoff (a build spawned from the service
  # would be killed by the restart it performs).
  update) local_url="$(gateway_local_url)"; MSO_UPDATE_ROOT="$ROOT" MSO_UPDATE_LOCAL_URL="$local_url" "$ROOT/scripts/mso-update" "$@" ;;

  # ── editor-document CRUD (one pattern, all editor features) ──────────────
  crud)
    sub="${1:-help}"; shift || true
    case "$sub" in
      list) jget "/api/v1/fs/list?path=$(enc "${1:?path}")" ;;
      get)  jget "/api/v1/fs/read?path=$(enc "${1:?path}")" | jq -r . ;;
      del)  jdel "/api/v1/fs/delete" "$(jq -n --arg p "${1:?path}" '{path:$p}')" ;;
      cmds) jget "/api/v1/editor/exec" | jq -r '.tools[] | "  \(.name)\t\(.description)"' ;;
      set)
        path="${1:?path}"; shift; op="${1:?command-or-content}"; shift || true
        if [[ "$op" =~ ^[a-z]+\.[a-zA-Z]+$ ]]; then
          # Editor-doc command → ONE atomic server op: the route reads the doc
          # (or seeds it), applies the command, and writes it back in place.
          a=$(kv_args "$@")
          resp=$(jpost "/api/v1/editor/exec" "$(jq -n --arg p "$path" --arg n "$op" --argjson a "$a" '{path:$p,commands:[{name:$n,args:$a}]}')")
          jq -e '.dimsFallback' >/dev/null 2>&1 <<<"$resp" && echo "  ! image dims unknown → defaulted (AVIF/HEIC/TIFF not probed)" >&2
          jq -r '.results[]? | "  \(.name) \(if .ok then "ok" else "ERR" end) — \(.result)"' <<<"$resp"
        else
          jpost "/api/v1/fs/write" "$(jq -n --arg p "$path" --arg c "$op${*:+ $*}" '{path:$p,content:$c}')"
        fi ;;
      *) die "usage: mso $U_crud" ;;
    esac ;;

  # ── escape hatch: any endpoint at all ────────────────────────────────────
  api)
    m="${1:?METHOD}"; p="${2:?/api/...}"; body="${3-}"
    if [ -n "$body" ]; then req -X "$m" -H 'content-type: application/json' -d "$body" "$B$p"
    else req -X "$m" "$B$p"; fi ;;

  # Verb list comes from verbs(), so completion cannot go stale.
  completion)
    case "${1:-bash}" in
      bash) printf 'complete -W "%s" mso\n' "$(verbs | grep -v '^-' | sort -u | tr '\n' ' ')" ;;
      zsh)  printf 'compdef _gnu_generic mso\ncompctl -k "(%s)" mso\n' "$(verbs | grep -v '^-' | sort -u | tr '\n' ' ')" ;;
      *) die "completion: bash|zsh   (eval \"\$(mso completion bash)\")" ;;
    esac
    exit 0 ;;
  *) die "internal CLI routing error: $cmd reached the wrong command family" ;;
esac
}
