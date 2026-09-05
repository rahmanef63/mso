#!/usr/bin/env bash
# Native connection management. All actions use the same owner API as the browser.
# shellcheck source=mso-cli-integrations-tui.sh
source "$ROOT/scripts/mso-cli-integrations-tui.sh"
run_integrations() {
  if [ $# -eq 0 ]; then
    if tty_ok && [ -t 0 ] && [ -t 1 ]; then integrations_tui; else jget "/api/v1/integrations?view=snapshot"; fi
    return
  fi
  local sub="$1" data user provider connection query body
  shift || true
  case "$sub" in
    import-sc) integration_sc_import_cli ;;
    transfer) data=$(jget "/api/v1/integrations/transfer"); printf "Open the owner-only JSON transfer page in your browser:\n%s\n" "$(jq -r .url <<<"$data")" ;;
    status|users|catalog)
      query="snapshot"; [ "$sub" = users ] && query=users; [ "$sub" = catalog ] && query=catalog
      jget "/api/v1/integrations?view=$query" ;;
    connections)
      query="view=connections"; [ -n "${1-}" ] && query="$query&user=$(enc "$1")"; [ -n "${2-}" ] && query="$query&provider=$(enc "$2")"
      jget "/api/v1/integrations?$query" ;;
    which) jget "/api/v1/integrations?view=which&cwd=$(enc "${1:-$PWD}")" ;;
    request|resolve)
      [ $# -ge 2 ] || die "usage: mso integrations $sub <user> <provider> [connection]"
      query="view=$sub&user=$(enc "$1")&provider=$(enc "$2")"; [ -n "${3-}" ] && query="$query&connection=$(enc "$3")"
      jget "/api/v1/integrations?$query" ;;
    setup)
      [ $# -eq 3 ] || die "usage: mso integrations setup <user> <provider> <connection>"
      tty_ok || die "private setup links are terminal-only; use integration_setup_open from MCP"
      user="$1"; provider="$2"; connection="$3"
      data=$(jpost "/api/v1/infra/setup" "$(jq -nc --arg user "$user" --arg provider "$provider" --arg connection "$connection" '{user:$user,provider:$provider,connection:$connection}')")
      printf 'Private setup for %s / %s / %s (10 minutes; do not share):\n%s#%s\n' "$user" "$provider" "$connection" "$(jq -r '.setupUrl' <<<"$data")" "$(jq -r '.token' <<<"$data")"
      unset data ;;
    create-user)
      [ $# -ge 1 ] || die "usage: mso integrations create-user <id> [label]"
      body=$(jq -nc --arg user "$1" --arg label "${2:-$1}" '{mode:"manage",action:"user.create",confirm:true,user:$user,label:$label}')
      jpost "/api/v1/integrations" "$body" ;;
    create-connection)
      [ $# -ge 5 ] || die "usage: mso integrations create-connection <user> <provider> <id> <direct|composio|native-mcp> <auth-method> [label]"
      body=$(jq -nc --arg user "$1" --arg provider "$2" --arg connection "$3" --arg source "$4" --arg authMethod "$5" --arg label "${6:-$3}" '{mode:"manage",action:"connection.create",confirm:true,user:$user,provider:$provider,connection:$connection,source:$source,authMethod:$authMethod,label:$label}')
      jpost "/api/v1/integrations" "$body" ;;
    manage)
      [ $# -eq 1 ] || die 'usage: mso integrations manage <metadata-JSON with action and confirm:true>'
      body=$(jq -ce 'if type=="object" and .confirm==true then .+{mode:"manage"} else error("explicit confirmation required") end' <<<"$1")
      data=$(jpost "/api/v1/integrations" "$body")
      if jq -e '.privateUrl' >/dev/null <<<"$data"; then
        if tty_ok; then jq . <<<"$data"; else jq 'del(.privateUrl)+{notice:"Authorization link available only in the private UI or interactive terminal"}' <<<"$data"; fi
      else printf '%s\n' "$data"; fi ;;
    verify|route)
      [ $# -eq 3 ] || die "usage: mso integrations $sub <user> <provider> <connection>"
      body=$(jq -nc --arg op "$sub" --arg user "$1" --arg provider "$2" --arg connection "$3" '{mode:"execute",operation:$op,user:$user,provider:$provider,connection:$connection}')
      jpost "/api/v1/integrations" "$body" ;;
    hostinger-mail-orders)
      [ $# -eq 2 ] || die "usage: mso integrations hostinger-mail-orders <user> <connection>"
      body=$(jq -nc --arg user "$1" --arg connection "$2" '{mode:"execute",operation:"hostinger.mail.orders.list",user:$user,provider:"hostinger",connection:$connection,confirm:true,arguments:{}}')
      jpost "/api/v1/integrations" "$body" ;;
    hostinger-mail-list)
      [ $# -ge 3 ] || die "usage: mso integrations hostinger-mail-list <user> <connection> <mailboxes|aliases|forwarders|autoreplies|catchalls|webhooks> [orderId] [page]"
      body=$(jq -nc --arg user "$1" --arg connection "$2" --arg resource "$3" --arg orderId "${4-}" --argjson page "${5:-1}" '{mode:"execute",operation:"hostinger.mail.list",user:$user,provider:"hostinger",connection:$connection,confirm:true,arguments:({resource:$resource,page:$page}+if $orderId!="" then {orderId:$orderId} else {} end)}')
      jpost "/api/v1/integrations" "$body" ;;
    hostinger-mail-logs)
      [ $# -ge 3 ] || die "usage: mso integrations hostinger-mail-logs <user> <connection> <access|action|inbound|mailbox-actions|outbound> [orderId] [page]"
      body=$(jq -nc --arg user "$1" --arg connection "$2" --arg kind "$3" --arg orderId "${4-}" --argjson page "${5:-1}" '{mode:"execute",operation:"hostinger.mail.logs.list",user:$user,provider:"hostinger",connection:$connection,confirm:true,arguments:({kind:$kind,page:$page}+if $orderId!="" then {orderId:$orderId} else {} end)}')
      jpost "/api/v1/integrations" "$body" ;;
    execute)
      [ $# -eq 1 ] || die 'usage: mso integrations execute <metadata-JSON with user, provider, connection, operation and confirm:true>'
      body=$(jq -ce 'if type=="object" then .+{mode:"execute"} else error("object required") end' <<<"$1")
      jpost "/api/v1/integrations" "$body" ;;
    *) die 'usage: mso integrations import-sc|transfer|status|users|catalog|connections|which|request|resolve|create-user|create-connection|manage|setup|verify|route|hostinger-mail-orders|hostinger-mail-list|hostinger-mail-logs|execute' ;;
  esac
}
