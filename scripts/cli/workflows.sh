#!/usr/bin/env bash
# Workflow Graph v2 CLI. Uses the same authenticated private API as the native Workflows app.
run_workflow() {
  local sub="${1:-list}" id="" input='{}' key="" revision="" wait=0 body result
  shift || true
  case "$sub" in
    show|save|clone|delete|run|status) id="${1:?workflow/run id required}"; shift ;;
  esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --input) input="${2:?JSON or @file required}"; shift 2 ;;
      --key) key="${2:?idempotency key required}"; shift 2 ;;
      --revision) revision="${2:?revision required}"; shift 2 ;;
      --wait) wait=1; shift ;;
      *) die "unknown workflow option: $1" ;;
    esac
  done
  case "$input" in @*) input=$(cat -- "${input#@}") ;; esac
  case "$sub" in
    list) jget "/api/v1/workflows"; return ;;
    show) jget "/api/v1/workflows?graph_id=$(enc "$id")"; return ;;
    status) result=$(jget "/api/v1/workflows?run_id=$(enc "$id")&wait_ms=$((wait * 1500))") ;;
    create)
      body=$(jq -n --argjson graph "$input" '{action:"create",graph:$graph}')
      jpost "/api/v1/workflows" "$body"; return ;;
    save)
      [ -n "$revision" ] || die "workflow save requires --revision from workflow show/list"
      body=$(jq -n --arg id "$id" --arg revision "$revision" --argjson graph "$input" '{action:"update",graph_id:$id,expected_revision:$revision,graph:$graph}')
      jpost "/api/v1/workflows" "$body"; return ;;
    clone)
      body=$(jq -n --arg id "$id" '{action:"clone",graph_id:$id}')
      jpost "/api/v1/workflows" "$body"; return ;;
    delete)
      [ -n "$revision" ] || die "workflow delete requires --revision from workflow show/list"
      body=$(jq -n --arg id "$id" --arg revision "$revision" '{action:"delete",graph_id:$id,expected_revision:$revision}')
      jpost "/api/v1/workflows" "$body"; return ;;
    run)
      [ -n "$key" ] || die "workflow run requires --key <unique-operation-id>; retries must reuse it"
      body=$(jq -n --arg id "$id" --arg key "$key" --argjson input "$input" '{action:"run",graph_id:$id,input:$input,idempotency_key:$key}')
      result=$(jpost "/api/v1/workflows" "$body"); id=$(jq -er .id <<<"$result") ;;
    *) die "usage: mso ${U_workflow:-workflow}" ;;
  esac
  while [ "$wait" -eq 1 ] && [ "$(jq -r .state <<<"$result")" = running ]; do
    result=$(jget "/api/v1/workflows?run_id=$(enc "$id")&wait_ms=1500")
  done
  printf '%s\n' "$result"
  case "$(jq -r .state <<<"$result")" in failed|interrupted) return 1 ;; esac
}
