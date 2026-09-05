#!/usr/bin/env bash
# Interactive native Integrations navigator. Metadata only: credential values still
# enter through the private browser form opened by `mso integrations setup`.

# shellcheck source=mso-cli-integrations-tui-remote.sh
source "$ROOT/scripts/mso-cli-integrations-tui-remote.sh"
integration_tui_pick() {
  local title="$1" active="${2-}" choice
  shift 2 || true
  if choice=$(tui_select "$title" "$active"); then printf '%s' "$choice"; return 0; fi
  return 1
}
integration_tui_pause() { tty_line "Press Enter to continue… " ""; }
integration_tui_snapshot() {
  local user="${1-}" query="view=snapshot"
  [ -n "$user" ] && query="$query&user=$(enc "$user")"
  jget "/api/v1/integrations?$query"
}
integration_tui_header() {
  local path="$1"
  printf '\n\033[1mMSO Integrations\033[0m  \033[2m%s\033[0m\n' "$path" > /dev/tty
}
integration_tui_slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g;s/^-+//;s/-+$//' | cut -c1-64
}
integration_tui_manage() {
  local body="$1" out
  out=$(jpost "/api/v1/integrations" "$body")
  printf '%s\n' "$out"
}
integration_tui_execute() {
  local user="$1" provider="$2" connection="$3" operation="$4" args="${5:-{}}" confirm="${6:-false}" body
  body=$(jq -nc --arg user "$user" --arg provider "$provider" --arg connection "$connection" --arg operation "$operation" --argjson args "$args" --argjson confirm "$confirm" '{mode:"execute",user:$user,provider:$provider,connection:$connection,operation:$operation,arguments:$args} + (if $confirm then {confirm:true} else {} end)')
  jpost "/api/v1/integrations" "$body"
}
integration_tui_add_user() {
  local id label body
  tty_line "New credential user ID: " ""; id="$REPLY"; [ -n "$id" ] || return 0
  tty_line "Display label [$id]: " "$id"; label="$REPLY"
  body=$(jq -nc --arg user "$id" --arg label "$label" '{mode:"manage",action:"user.create",confirm:true,user:$user,label:$label}')
  integration_tui_manage "$body" | jq '{ok,action,user}'
  integration_tui_pause
}
integration_tui_user_actions() {
  local user="$1" choice target label copy body answer
  while true; do
    integration_tui_header "Users › $user"
    choice=$(cat <<'ROWS' | integration_tui_pick "User · actions" ""
providers	Connections & providers	manage named accounts/deployments
make-default	Set as default user	fallback when no folder mapping matches
bind-folder	Use for current folder	longest folder mapping wins
rename	Rename user	preserve connections and folder mappings
duplicate	Duplicate user	metadata by default; credentials require opt-in
delete	Delete user	destructive; exact confirmation required
__back	← Back	users
ROWS
) || return 0
    case "$choice" in
      __back) return 0 ;;
      providers) integration_tui_provider_flow "$user" ;;
      make-default)
        body=$(jq -nc --arg user "$user" '{mode:"manage",action:"user.default",confirm:true,user:$user}')
        integration_tui_manage "$body" | jq '{ok,action,user}'; integration_tui_pause ;;
      bind-folder)
        body=$(jq -nc --arg user "$user" --arg path "$PWD" '{mode:"manage",action:"folder.map",confirm:true,user:$user,path:$path}')
        integration_tui_manage "$body" | jq '{ok,action,user,path}'; integration_tui_pause ;;
      rename)
        tty_line "New user ID: " "$user"; target="$REPLY"; [ "$target" != "$user" ] || continue
        tty_line "Display label [$target]: " "$target"; label="$REPLY"
        body=$(jq -nc --arg user "$user" --arg target "$target" --arg label "$label" '{mode:"manage",action:"user.rename",confirm:true,user:$user,target:$target,label:$label}')
        integration_tui_manage "$body" | jq '{ok,action,user}'; user="$target"; integration_tui_pause ;;
      duplicate)
        tty_line "Duplicate as user ID: " "${user}-copy"; target="$REPLY"; [ -n "$target" ] || continue
        tty_line "Display label [$target]: " "$target"; label="$REPLY"
        tty_line "Copy direct credentials too? [y/N]: " "n"; answer="${REPLY,,}"; copy=false; case "$answer" in y|yes) copy=true;; esac
        body=$(jq -nc --arg user "$user" --arg target "$target" --arg label "$label" --argjson copy "$copy" '{mode:"manage",action:"user.duplicate",confirm:true,user:$user,target:$target,label:$label,copyCredentials:$copy}')
        integration_tui_manage "$body" | jq '{ok,action,user}'; integration_tui_pause ;;
      delete)
        tty_line "Type $user to delete this credential user: " ""; [ "$REPLY" = "$user" ] || { echo "Cancelled."; integration_tui_pause; continue; }
        body=$(jq -nc --arg user "$user" '{mode:"manage",action:"user.delete",confirm:true,user:$user}')
        integration_tui_manage "$body" | jq '{ok,action,user}'; integration_tui_pause; return 0 ;;
    esac
  done
}
integration_tui_users() {
  local snap choice rows
  while true; do
    snap=$(integration_tui_snapshot)
    rows=$(jq -r '.users[] | [.id,.label,((.connectionCount|tostring)+" connection(s)" + (if .isDefault then " · default" else "" end)),(if .isDefault then "current" else "" end)]|@tsv' <<<"$snap")
    integration_tui_header "Users"
    choice=$({ printf '%s\n' "$rows"; printf '__add\t＋ Add user\tnew isolated credential owner\n__back\t← Back\tIntegrations\n'; } | integration_tui_pick "Credential users" "$(jq -r '.user // empty' <<<"$snap")") || return 0
    case "$choice" in __back) return 0;; __add) integration_tui_add_user;; *) integration_tui_user_actions "$choice";; esac
  done
}
integration_tui_browse_providers() {
  local snap choice row
  snap=$(integration_tui_snapshot)
  while true; do
    integration_tui_header "Providers"
    choice=$({ jq -r '.catalog[]|[.id,.title,((.sources|length|tostring)+" source(s)"),""]|@tsv' <<<"$snap"; printf '__back\t← Back\tIntegrations\n'; } | integration_tui_pick "Provider catalog" "") || return 0
    [ "$choice" = __back ] && return 0
    row=$(jq -c --arg id "$choice" '.catalog[]|select(.id==$id)' <<<"$snap")
    printf '\n%s — %s\n' "$(jq -r .title <<<"$row")" "$(jq -r .description <<<"$row")"
    jq -r '.sources[] | "  " + .label + "\n" + (.methods[] | "    • " + .label + " · " + .scope)' <<<"$row"
    integration_tui_pause
  done
}
integration_tui_new_connection() {
  local user="$1" provider="$2" snap source method label id idDefault body answer
  snap=$(integration_tui_snapshot "$user")
  integration_tui_header "$user › $provider › New connection"
  source=$(jq -r --arg id "$provider" '.catalog[]|select(.id==$id)|.sources[]|[.id,.label,((.methods|length|tostring)+" auth method(s)"),""]|@tsv' <<<"$snap" | integration_tui_pick "Source / backend" "") || return 0
  method=$(jq -r --arg p "$provider" --arg s "$source" '.catalog[]|select(.id==$p)|.sources[]|select(.id==$s)|.methods[]|[.id,.label,(.scope+" · "+((.fields|length|tostring))+" field(s)"),""]|@tsv' <<<"$snap" | integration_tui_pick "Authentication" "") || return 0
  tty_line "Connection label: " "$provider"; label="$REPLY"; [ -n "$label" ] || return 0
  idDefault=$(integration_tui_slug "$label"); [ -n "$idDefault" ] || idDefault=connection
  tty_line "Connection ID [$idDefault]: " "$idDefault"; id="$REPLY"
  body=$(jq -nc --arg user "$user" --arg provider "$provider" --arg connection "$id" --arg label "$label" --arg source "$source" --arg method "$method" '{mode:"manage",action:"connection.create",confirm:true,user:$user,provider:$provider,connection:$connection,label:$label,source:$source,authMethod:$method}')
  integration_tui_manage "$body" | jq '{ok,action,connection:(.connection|{id,label,provider,source,authMethod,scope,state,isDefault})}'
  if [ "$source" = direct ]; then
    tty_line "Open secure credential form now? [Y/n]: " "y"; answer="${REPLY,,}"
    case "$answer" in n|no) ;; *) run_integrations setup "$user" "$provider" "$id";; esac
  fi
  integration_tui_pause
}
integration_tui_connection() {
  local user="$1" provider="$2" connection="$3" choice snap row source isDefault body label confirm out
  while true; do
    snap=$(integration_tui_snapshot "$user")
    row=$(jq -c --arg p "$provider" --arg c "$connection" '.connections[]|select(.provider==$p and .id==$c)' <<<"$snap")
    [ -n "$row" ] || return 0
    source=$(jq -r .source <<<"$row"); isDefault=$(jq -r '.isDefault//false' <<<"$row")
    integration_tui_header "$user › $provider › $(jq -r .label <<<"$row")"
    choice=$({
      [ "$source" = direct ] && printf 'setup\tSet / rotate credentials\tprivate browser form\n'
      [ "$source" = composio ] && printf 'authorize\tAuthorize account\tComposio hosted authorization\n'
      printf 'verify\tVerify\tlive API/auth status\nroute\tRoute\tshow exact execution identity\n'
      [ "$isDefault" != true ] && printf 'default\tMake default\tprovider fallback for this user\n'
      [ "$provider" = hostinger ] && [ "$source" = direct ] && printf 'mail\tHostinger Mail\torders, mailboxes, aliases, logs…\n'
      printf 'rename\tRename label\tmetadata only\ndelete\tDelete connection\tdestructive; exact confirmation\n__back\t← Back\tprovider\n'
    } | integration_tui_pick "Connection actions" "") || return 0
    case "$choice" in
      __back) return 0 ;;
      setup) run_integrations setup "$user" "$provider" "$connection"; integration_tui_pause ;;
      authorize) integration_tui_composio_authorize "$user" "$provider" "$connection" ;;
      verify) out=$(integration_tui_execute "$user" "$provider" "$connection" verify '{}' false); jq '{ok,detail,id,user,connection}' <<<"$out"; integration_tui_pause ;;
      route) out=$(integration_tui_execute "$user" "$provider" "$connection" route '{}' false); jq '.' <<<"$out"; integration_tui_pause ;;
      default) body=$(jq -nc --arg user "$user" --arg provider "$provider" --arg connection "$connection" '{mode:"manage",action:"connection.default",confirm:true,user:$user,provider:$provider,connection:$connection}'); integration_tui_manage "$body" | jq '{ok,action,connection:(.connection|{id,label,isDefault})}'; integration_tui_pause ;;
      mail) integration_tui_hostinger_mail "$user" "$connection" ;;
      rename) tty_line "New label: " "$(jq -r .label <<<"$row")"; label="$REPLY"; body=$(jq -nc --arg user "$user" --arg provider "$provider" --arg connection "$connection" --arg label "$label" '{mode:"manage",action:"connection.rename",confirm:true,user:$user,provider:$provider,connection:$connection,label:$label}'); integration_tui_manage "$body" | jq '{ok,action,connection:(.connection|{id,label})}'; integration_tui_pause ;;
      delete) tty_line "Type $connection to delete this connection: " ""; confirm="$REPLY"; [ "$confirm" = "$connection" ] || { echo 'Cancelled.'; integration_tui_pause; continue; }; body=$(jq -nc --arg user "$user" --arg provider "$provider" --arg connection "$connection" '{mode:"manage",action:"connection.delete",confirm:true,user:$user,provider:$provider,connection:$connection}'); integration_tui_manage "$body" | jq '{ok,action,user,provider,connection}'; integration_tui_pause; return 0 ;;
    esac
  done
}
integration_tui_provider_flow() {
  local user="$1" snap provider choice rows count title
  while true; do
    snap=$(integration_tui_snapshot "$user")
    integration_tui_header "$user › Providers"
    provider=$({ jq -r --arg u "$user" '.catalog[] as $p | [$p.id,$p.title,(([.connections[]|select(.provider==$p.id)]|length|tostring)+" connection(s)"),""]|@tsv' <<<"$snap"; printf '__back\t← Back\tuser\n'; } | integration_tui_pick "Providers" "") || return 0
    [ "$provider" = __back ] && return 0
    while true; do
      snap=$(integration_tui_snapshot "$user")
      title=$(jq -r --arg id "$provider" '.catalog[]|select(.id==$id)|.title' <<<"$snap")
      rows=$(jq -r --arg p "$provider" '.connections[]|select(.provider==$p)|[.id,.label,(.source+" · "+.authMethod+" · "+.state+(if .isDefault then " · default" else "" end)),(if .isDefault then "current" else "" end)]|@tsv' <<<"$snap")
      integration_tui_header "$user › $title"
      choice=$({ printf '%s\n' "$rows"; printf '__new\t＋ New connection\tchoose source/backend and auth\n__back\t← Back\tproviders\n'; } | integration_tui_pick "$title · connections" "") || break
      case "$choice" in __back) break;; __new) integration_tui_new_connection "$user" "$provider";; *) integration_tui_connection "$user" "$provider" "$choice";; esac
    done
  done
}
integration_tui_connections() {
  local snap choice rows
  while true; do
    snap=$(integration_tui_snapshot)
    rows=$(jq -r '.users[]|[.id,.label,((.connectionCount|tostring)+" connection(s)"+(if .isDefault then " · default" else "" end)),(if .isDefault then "current" else "" end)]|@tsv' <<<"$snap")
    integration_tui_header "Connections"
    choice=$({ printf '%s\n' "$rows"; printf '__add\t＋ Add user\tcreate credential owner first\n__back\t← Back\tIntegrations\n'; } | integration_tui_pick "Choose credential user" "$(jq -r '.user // empty' <<<"$snap")") || return 0
    case "$choice" in __back) return 0;; __add) integration_tui_add_user;; *) integration_tui_provider_flow "$choice";; esac
  done
}
integrations_tui() {
  local choice out
  tty_ok || { jget "/api/v1/integrations?view=snapshot"; return; }
  while true; do
    integration_tui_header "Home"
    choice=$(cat <<'ROWS' | integration_tui_pick "Integrations" ""
connections	Connections	User → Provider → Connection → Source → Auth
users	Credential users	isolated account owners
providers	Provider catalog	sources, auth methods and scope
current	Current folder	show resolved credential user/bindings
transfer	Import / export JSON	portable metadata or encrypted direct credentials
quit	Quit	return to shell
ROWS
) || return 0
    case "$choice" in
      connections) integration_tui_connections ;;
      users) integration_tui_users ;;
      providers) integration_tui_browse_providers ;;
      current) out=$(jget "/api/v1/integrations?view=which&cwd=$(enc "$PWD")"); jq '{user,resolution,bindings}' <<<"$out"; integration_tui_pause ;;
      transfer) run_integrations transfer; integration_tui_pause ;;
      quit) return 0 ;;
    esac
  done
}
