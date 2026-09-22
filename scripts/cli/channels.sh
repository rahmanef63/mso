#!/usr/bin/env bash
# Channels CLI. Channel configuration is metadata-only; credentials stay in Integrations.
run_channels() {
  local sub="${1:-list}" id="" input='{}' revision="" target="" message="" body
  shift || true
  case "$sub" in
    save|delete|test|send) id="${1:?channel id required}"; shift ;;
  esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --input) input="${2:?JSON or @file required}"; shift 2 ;;
      --revision) revision="${2:?revision required}"; shift 2 ;;
      --target) target="${2:?target required}"; shift 2 ;;
      --text) message="${2:?message text required}"; shift 2 ;;
      *) die "unknown channels option: $1" ;;
    esac
  done
  if [ "${input:0:1}" = "@" ]; then input=$(cat -- "${input:1}"); fi
  case "$sub" in
    list) jget "/api/v1/channels" ;;
    create)
      body=$(jq -n --argjson data "$input" '{action:"create",data:$data}')
      jpost "/api/v1/channels" "$body" ;;
    save)
      [ -n "$revision" ] || die "channels save requires --revision"
      body=$(jq -n --arg id "$id" --argjson revision "$revision" --argjson data "$input" '{action:"update",id:$id,expectedRevision:$revision,data:$data}')
      jpost "/api/v1/channels" "$body" ;;
    delete)
      [ -n "$revision" ] || die "channels delete requires --revision"
      body=$(jq -n --arg id "$id" --argjson revision "$revision" '{action:"delete",id:$id,expectedRevision:$revision}')
      jpost "/api/v1/channels" "$body" ;;
    test)
      body=$(jq -n --arg id "$id" '{action:"test",id:$id}')
      jpost "/api/v1/channels" "$body" ;;
    send)
      [ -n "$message" ] || die "channels send requires --text"
      body=$(jq -n --arg id "$id" --arg text "$message" --arg target "$target" '{action:"send",id:$id,text:$text}+if $target!="" then {target:$target} else {} end')
      jpost "/api/v1/channels" "$body" ;;
    *) die "usage: mso ${U_channels:-channels}" ;;
  esac
}
