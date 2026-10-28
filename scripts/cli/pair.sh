#!/usr/bin/env bash
# Ready-to-use origins and pending-device approval paths without mutations or tunnels.

mso_pair() {
  local json_mode=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --json)
        json_mode=1
        shift ;;
      -h|--help|help)
        echo "usage: mso pair [--json]"
        return 0 ;;
      *)
        echo "usage: mso pair [--json]" >&2
        exit 1 ;;
    esac
  done

  # Loopback upstream is authoritative for local login
  local loopback_url
  loopback_url="$(gateway_local_url)"

  # Check configured public origin first, then cheap cached gateway state
  local public_origin=""
  if [ -n "${OS_PUBLIC_ORIGIN:-}" ]; then
    public_origin="$OS_PUBLIC_ORIGIN"
  else
    local can_root scope_id state_file
    can_root="$(realpath -e -- "$ROOT" 2>/dev/null || true)"
    if [ -n "$can_root" ]; then
      scope_id="$(printf '%s\n%s' "$can_root" "$loopback_url" | sha256sum | awk '{print $1}')"
      state_file="$HOME/.mso/private/gateway/$scope_id/state.json"
      if [ -f "$state_file" ]; then
        public_origin="$(jq -r '.url // empty' "$state_file" 2>/dev/null || true)"
      fi
    fi
  fi

  # Stable CLI device identity
  local dev_id
  dev_id="$(cli_device)"

  # Cheap read-only session probe matching mso health without triggering lazy login
  local signed_in="false"
  if [ -s "${JAR:-}" ]; then
    local health_body
    health_body="$(curl -sS --max-time 2 -b "$JAR" "${ORIGIN[@]}" "$B/api/auth/me" 2>/dev/null || true)"
    if [ "$(jq -r '.authenticated // false' <<<"$health_body" 2>/dev/null)" = "true" ]; then
      signed_in="true"
    fi
  fi

  # Query local allowlist directly without network roundtrips
  local pending_out pending_lines pending_count=0 next_cmd=""
  pending_out="$(dev_script --pending 2>/dev/null || true)"
  pending_lines="$(sed -n 's/^[[:space:]]*\(mso device approve .*\)$/\1/p' <<<"$pending_out")"
  if [ -n "$pending_lines" ]; then
    pending_count="$(grep -c . <<<"$pending_lines")"
    next_cmd="$(head -n 1 <<<"$pending_lines")"
  fi

  if [ "$json_mode" -eq 1 ]; then
    jq -n \
      --arg loopback "$loopback_url" \
      --arg public "$public_origin" \
      --arg device "$dev_id" \
      --argjson signedIn "$signed_in" \
      --argjson pending "$pending_count" \
      --arg next "$next_cmd" \
      '{
        loopback: $loopback,
        public: (if $public == "" then null else $public end),
        device: $device,
        signedIn: $signedIn,
        pending: $pending,
        next: (if $next == "" then null else $next end)
      }'
    return 0
  fi

  local public_display="${public_origin:-not configured}"
  local signed_status="not signed in"
  [ "$signed_in" = "true" ] && signed_status="signed in"

  echo "Loopback:       $loopback_url (browser login requires HTTPS or localhost, never plain http://<server-ip>)"
  echo "Public origin:  $public_display"
  echo "CLI device:     $dev_id ($signed_status)"
  echo "Pending:        $pending_count"
  if [ -n "$next_cmd" ]; then
    echo "Next:           $next_cmd"
  else
    echo "Next:           none"
  fi
}
