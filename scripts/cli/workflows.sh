#!/usr/bin/env bash
# Workflow Graph CLI. Same private API as native Workflows app and workflow_graph MCP tool.
run_workflow() {
  local sub="${1:-list}" id="" input='{}' key="" revision="" version="" wait=0 secret=false query="" prompt="" result body
  shift || true
  case "$sub" in
    show|save|clone|delete|run|status|runs|versions|restore|template|variable-set|variable-delete) id="${1:?workflow/id required}"; shift ;;
  esac
  while [ $# -gt 0 ]; do
    case "$1" in
      --input) input="${2:?JSON or @file required}"; shift 2 ;;
      --key) key="${2:?idempotency key required}"; shift 2 ;;
      --revision) revision="${2:?current revision required}"; shift 2 ;;
      --version) version="${2:?saved version revision required}"; shift 2 ;;
      --query) query="${2:-}"; shift 2 ;;
      --prompt) prompt="${2:?prompt required}"; shift 2 ;;
      --secret) secret=true; shift ;;
      --wait) wait=1; shift ;;
      *) die "unknown workflow option: $1" ;;
    esac
  done
  if [ "${input:0:1}" = "@" ]; then input=$(cat -- "${input:1}"); fi
  case "$sub" in
    list) jget "/api/v1/workflows"; return ;;
    embeds) jget "/api/v1/workflow-embeds"; return ;;
    embed-save) jpost "/api/v1/workflow-embeds" "$input"; return ;;
    show) jget "/api/v1/workflows?graph_id=$(enc "$id")"; return ;;
    runs) jget "/api/v1/workflows?runs=1&graph_id=$(enc "$id")"; return ;;
    versions) jget "/api/v1/workflows?versions=$(enc "$id")"; return ;;
    catalog) jget "/api/v1/workflows?catalog=1&q=$(enc "$query")"; return ;;
    templates) jget "/api/v1/workflows?templates=1"; return ;;
    variables) jget "/api/v1/workflows?variables=1"; return ;;
    status) result=$(jget "/api/v1/workflows?run_id=$(enc "$id")&wait_ms=$((wait * 1500))") ;;
    create) body=$(jq -n --argjson graph "$input" '{action:"create",graph:$graph}'); jpost "/api/v1/workflows" "$body"; return ;;
    save) [ -n "$revision" ] || die "workflow save requires --revision"; body=$(jq -n --arg id "$id" --arg revision "$revision" --argjson graph "$input" '{action:"update",graph_id:$id,expected_revision:$revision,graph:$graph}'); jpost "/api/v1/workflows" "$body"; return ;;
    clone) body=$(jq -n --arg id "$id" '{action:"clone",graph_id:$id}'); jpost "/api/v1/workflows" "$body"; return ;;
    delete) [ -n "$revision" ] || die "workflow delete requires --revision"; body=$(jq -n --arg id "$id" --arg revision "$revision" '{action:"delete",graph_id:$id,expected_revision:$revision}'); jpost "/api/v1/workflows" "$body"; return ;;
    restore) [ -n "$revision" ] && [ -n "$version" ] || die "workflow restore requires --revision <current> --version <saved>"; body=$(jq -n --arg id "$id" --arg current "$revision" --arg version "$version" '{action:"restore_version",graph_id:$id,expected_revision:$current,revision:$version}'); jpost "/api/v1/workflows" "$body"; return ;;
    template) body=$(jq -n --arg id "$id" '{action:"create_from_template",template_id:$id}'); jpost "/api/v1/workflows" "$body"; return ;;
    variable-set) body=$(jq -n --arg key "$id" --argjson value "$input" --argjson secret "$secret" '{action:"variable_set",key:$key,value:$value,secret:$secret}'); jpost "/api/v1/workflows" "$body"; return ;;
    variable-delete) body=$(jq -n --arg key "$id" '{action:"variable_delete",key:$key}'); jpost "/api/v1/workflows" "$body"; return ;;
    ai) [ -n "$prompt" ] || die "workflow ai requires --prompt"; body=$(jq -n --arg prompt "$prompt" '{action:"ai_suggest",prompt:$prompt}'); jpost "/api/v1/workflows" "$body"; return ;;
    run) [ -n "$key" ] || die "workflow run requires --key <unique-operation-id>"; body=$(jq -n --arg id "$id" --arg key "$key" --argjson input "$input" '{action:"run",graph_id:$id,input:$input,idempotency_key:$key}'); result=$(jpost "/api/v1/workflows" "$body"); id=$(jq -er .id <<<"$result") ;;
    *) die "usage: mso ${U_workflow:-workflow}" ;;
  esac
  while [ "$wait" -eq 1 ] && [ "$(jq -r .state <<<"$result")" = running ]; do result=$(jget "/api/v1/workflows?run_id=$(enc "$id")&wait_ms=1500"); done
  printf '%s\n' "$result"
  case "$(jq -r .state <<<"$result")" in
    failed|interrupted) return 1 ;;
  esac
}
