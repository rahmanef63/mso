#!/usr/bin/env bash
# External/Hostinger submenus for the interactive Integrations navigator.
integration_tui_composio_authorize() {
  local user="$1" provider="$2" connection="$3" broker config answer managed body out
  tty_line "Composio project connection ID (blank = auto): " ""; broker="$REPLY"
  tty_line "Auth config ID (blank = auto): " ""; config="$REPLY"
  tty_line "Allow a managed OAuth config if none exists? [y/N]: " "n"; answer="${REPLY,,}"; managed=false; case "$answer" in y|yes) managed=true;; esac
  body=$(jq -nc --arg user "$user" --arg provider "$provider" --arg connection "$connection" --arg broker "$broker" --arg config "$config" --argjson managed "$managed" '{mode:"manage",action:"connection.authorize",confirm:true,user:$user,provider:$provider,connection:$connection,createManaged:$managed} + (if $broker!="" then {brokerConnection:$broker} else {} end) + (if $config!="" then {authConfigId:$config} else {} end)')
  out=$(integration_tui_manage "$body")
  jq 'del(.privateUrl)' <<<"$out"
  if jq -e '.privateUrl' >/dev/null 2>&1 <<<"$out"; then printf '\nOpen this private authorization URL:\n%s\n' "$(jq -r .privateUrl <<<"$out")"; fi
  integration_tui_pause
}
integration_tui_hostinger_mail() {
  local user="$1" connection="$2" choice order resource kind out args
  while true; do
    integration_tui_header "$user › Hostinger › $connection › Mail"
    choice=$(cat <<'ROWS' | integration_tui_pick "Hostinger Mail" ""
orders	Mail orders	list account mail orders
mailboxes	Mailboxes	list mailboxes for an order
aliases	Aliases	list aliases
forwarders	Forwarders	list forwarders
autoreplies	Autoreplies	list automatic replies
catchalls	Catch-alls	list catch-all routes
webhooks	Webhooks	list webhook metadata
logs	Mail logs	access/action/inbound/mailbox/outbound
__back	← Back	connection
ROWS
) || return 0
    [ "$choice" = __back ] && return 0
    if [ "$choice" = orders ]; then
      out=$(integration_tui_execute "$user" hostinger "$connection" hostinger.mail.orders.list '{}' true)
      jq '.result' <<<"$out"; integration_tui_pause; continue
    fi
    tty_line "Mail order ID (blank uses scoped connection order): " ""; order="$REPLY"
    if [ "$choice" = logs ]; then
      kind=$(cat <<'ROWS' | integration_tui_pick "Mail log" ""
access	Access	access events
action	Action	action events
inbound	Inbound	inbound mail
mailbox-actions	Mailbox actions	mailbox mutations
outbound	Outbound	outbound mail
ROWS
) || continue
      args=$(jq -nc --arg order "$order" --arg kind "$kind" '{kind:$kind,page:1}+(if $order!="" then {orderId:$order} else {} end)')
      out=$(integration_tui_execute "$user" hostinger "$connection" hostinger.mail.logs.list "$args" true)
    else
      resource="$choice"; args=$(jq -nc --arg order "$order" --arg resource "$resource" '{resource:$resource,page:1}+(if $order!="" then {orderId:$order} else {} end)')
      out=$(integration_tui_execute "$user" hostinger "$connection" hostinger.mail.list "$args" true)
    fi
    jq '.result' <<<"$out"; integration_tui_pause
  done
}
