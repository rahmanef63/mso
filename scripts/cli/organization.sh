#!/usr/bin/env bash
# Owner-private Organization CLI. Same API as Alfa → Organization and MCP.
run_org() {
  local sub="${1:-show}"
  local revision=""
  local input=""
  local action=""
  local key=""
  local body=""
  local id=""
  shift || true

  case "$sub" in
    show|list)
      jget "/api/v1/organization"
      ;;
    unit-upsert|seat-upsert|replace)
      revision="${1:?revision}"; input="${2:?JSON or @file}"; if [ "${input:0:1}" = "@" ]; then input=$(cat -- "${input:1}"); fi
      action="${sub//-/_}"; key="${sub%%-*}"
      if [ "$sub" = replace ]; then body=$(jq -n --arg action "$action" --arg revision "$revision" --argjson chart "$input" '{action:$action,expected_revision:$revision,chart:$chart}')
      else body=$(jq -n --arg action "$action" --arg revision "$revision" --arg key "$key" --argjson data "$input" '{action:$action,expected_revision:$revision} + {($key):$data}'); fi
      jpost "/api/v1/organization" "$body" ;;
    unit-delete|seat-delete)
      revision="${1:?revision}"; id="${2:?id}"; action="${sub//-/_}"
      jpost "/api/v1/organization" "$(jq -n --arg action "$action" --arg revision "$revision" --arg id "$id" '{action:$action,expected_revision:$revision,id:$id}')" ;;
    *) die "usage: mso ${U_org:?Organization CLI usage contract unavailable}" ;;
  esac
}
