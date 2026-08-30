#!/usr/bin/env bash
# Handshake + provisional child identity for the fork -> cloudflared exec window.

TUNNEL_PENDING_PID=0
TUNNEL_PENDING_TICKS=''
TUNNEL_PENDING_GATE=''
TUNNEL_SPAWN_PID=0

gateway_track_pending_tunnel() {
  local pid="$1" ticks i
  TUNNEL_PENDING_PID="$pid"; TUNNEL_PENDING_TICKS=''
  for i in $(seq 1 20); do
    ticks="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
    [ -n "$ticks" ] && { TUNNEL_PENDING_TICKS="$ticks"; GATEWAY_PENDING_CLEANUP=1; return 0; }
    gateway_pid_alive "$pid" || return 1
    sleep 0.01
  done
  return 1
}

gateway_pending_gate_cleanup() {
  local gate="${TUNNEL_PENDING_GATE:-}"
  [ -n "$gate" ] || return 0
  if [ -e "$gate" ] || [ -L "$gate" ]; then
    mso_private_state_remove_file "$gate" >/dev/null 2>&1 || true
  fi
  TUNNEL_PENDING_GATE=''
}

gateway_stop_pending_tunnel() {
  local pid="${TUNNEL_PENDING_PID:-0}" ticks="${TUNNEL_PENDING_TICKS:-}" live i
  gateway_pending_gate_cleanup
  [ "$pid" -gt 1 ] 2>/dev/null && [ -n "$ticks" ] || return 0
  live="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
  [ "$live" = "$ticks" ] || { TUNNEL_PENDING_PID=0; TUNNEL_PENDING_TICKS=''; return 0; }
  kill "$pid" 2>/dev/null || true
  for i in $(seq 1 25); do
    live="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
    [ "$live" != "$ticks" ] && break
    sleep 0.04
  done
  live="$(gateway_proc_start_ticks "$pid" 2>/dev/null || true)"
  [ "$live" != "$ticks" ] || kill -KILL "$pid" 2>/dev/null || true
  TUNNEL_PENDING_PID=0; TUNNEL_PENDING_TICKS=''
}

gateway_spawn_held_tunnel() {
  local parent_ticks gate pid safe_path safe_lang i
  parent_ticks="$(gateway_proc_start_ticks $$)" || return 1
  safe_path="${PATH:-/usr/local/bin:/usr/bin:/bin}"; safe_lang="${LANG:-C.UTF-8}"
  for i in $(seq 1 20); do
    gate="$STATE_ROOT/.tunnel-release.$$.$RANDOM"
    [ ! -e "$gate" ] && [ ! -L "$gate" ] && break
    gate=''
  done
  [ -n "${gate:-}" ] || return 1
  TUNNEL_PENDING_GATE="$gate"

  # The helper starts in a scrubbed environment and cannot exec cloudflared until
  # this parent has recorded the child lifetime. If this parent dies first, the
  # helper observes the missing/reused parent PID and exits on its own.
  nohup env -i "HOME=$HOME" "PATH=$safe_path" "LANG=$safe_lang" \
    /bin/bash "$ROOT/scripts/lib/gateway-held-child.sh" "$$" "$parent_ticks" "$gate" "$@" \
    >>"$CF_LOG" 2>&1 & pid=$!
  if ! gateway_track_pending_tunnel "$pid"; then
    kill "$pid" 2>/dev/null || true
    gateway_pending_gate_cleanup
    return 1
  fi
  printf '1\n' | mso_private_state_atomic_write "$gate" >/dev/null || { gateway_stop_pending_tunnel; return 1; }
  TUNNEL_SPAWN_PID="$pid"
}
