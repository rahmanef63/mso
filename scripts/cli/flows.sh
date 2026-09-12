#!/usr/bin/env bash
# Flows share the owner API/capability kernel used by MCP.
run_flow() {
  local sub="${1:-list}" id="" project="$PWD" input='{}' key="" wait=0 revision="" body result
  shift || true
  case "$sub" in
    inspect|run|status|save|delete) id="${1:?flow/run id required}"; shift ;;
  esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) project="${2:?project required}"; shift 2 ;;
      --input) input="${2:?JSON or @file required}"; shift 2 ;;
      --key) key="${2:?idempotency key required}"; shift 2 ;;
      --revision) revision="${2:?revision required}"; shift 2 ;;
      --wait) wait=1; shift ;;
      *) die "unknown flow option: $1" ;;
    esac
  done
  case "$input" in
    @*) input=$(cat -- "${input#@}") ;;
  esac
  case "$sub" in
    list|inspect) jget "/api/v1/flows?project=$(enc "$project")&flow=$(enc "$id")"; return ;;
    status) result=$(jget "/api/v1/flows?run_id=$(enc "$id")&wait_ms=$((wait * 25000))") ;;
    run)
      [ -n "$key" ] || die "flow run requires --key <unique-operation-id>; retries must reuse it"
      body=$(jq -n --arg project "$project" --arg flow "$id" --arg key "$key" --argjson input "$input" '{action:"run",project:$project,flow:$flow,input:$input,idempotency_key:$key}')
      result=$(jpost "/api/v1/flows" "$body"); id=$(jq -er .id <<<"$result") ;;
    save|delete)
      [ -n "$revision" ] || die "use --revision from mso flow list (new for absent manifest)"
      local action=upsert; [ "$sub" = delete ] && action=delete
      body=$(jq -n --arg action "$action" --arg project "$project" --arg flow "$id" --arg revision "$revision" --argjson definition "$input" '{action:$action,project:$project,flow:$flow,revision:$revision,definition:$definition}')
      jpost "/api/v1/flows" "$body"; return ;;
    *) die "usage: mso ${U_flow:-flow}" ;;
  esac
  while [ "$wait" -eq 1 ] && [ "$(jq -r .state <<<"$result")" = running ]; do
    result=$(jget "/api/v1/flows?run_id=$(enc "$id")&wait_ms=25000")
  done
  printf '%s\n' "$result"
  case "$(jq -r .state <<<"$result")" in
    failed|interrupted) return 1 ;;
  esac
}
