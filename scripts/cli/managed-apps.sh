#!/usr/bin/env bash
# One application lifecycle: install if absent, wait for its job, then start.
mso_mapp_result() {
  local result="$1"
  printf '%s\n' "$result"
  if jq -e '.app.domainDiagnostic != null' <<<"$result" >/dev/null; then
    echo "mso: application action completed; domain setup needs attention (see domainDiagnostic above)" >&2
    return 2
  fi
}

mso_mapp_lifecycle() {
  local action="$1" id="${2:?application ID required}" response
  [ "$#" -eq 2 ] || die "usage: mso mapp $action <id>"
  response="$(jpost "/api/v1/managed-apps/$(enc "$id")" "$(jq -nc --arg a "$action" '{action:$a}')")" || return $?
  mso_mapp_result "$response"
}

mso_mapp_enable() {
  local id="${1:?application ID required}" response job
  shift
  case "$id" in hermes|openclaw|9router) ;; *) die "choose hermes, openclaw or 9router" ;; esac
  response="$(jget "/api/v1/managed-apps/$(enc "$id")")"
  if ! jq -e '.app.installed == true' <<<"$response" >/dev/null; then
    response="$(jpost "/api/v1/managed-apps/$(enc "$id")/install" "$(kv_args "$@")")"
    job="$(jq -r '.job.id // empty' <<<"$response")"
    [ -n "$job" ] || die "installer did not return a job ID"
    wait_managed_job "$id" "$job" >&2
  elif [ "$#" -gt 0 ]; then
    die "application is already installed; install options cannot change an existing installation"
  fi
  mso_mapp_lifecycle start "$id"
}
