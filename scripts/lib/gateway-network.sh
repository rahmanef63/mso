#!/usr/bin/env bash
# Prove that the MSO application port has no non-loopback listener before an
# Internet tunnel is allowed. Reads kernel socket tables directly: no mutable
# firewall assumption and no dependency on `ss`/net-tools.

gateway_port_exposure_state() {
  local port hex file line addr state seen=0 exposed=0
  port="$(node - "$LOCAL_URL" <<'NODE'
const u=new URL(process.argv[2]); process.stdout.write(u.port);
NODE
)"
  [[ "$port" =~ ^[0-9]{1,5}$ ]] || return 2
  printf -v hex '%04X' "$port"
  for file in "${MSO_GATEWAY_PROC_NET_TCP:-/proc/net/tcp}" "${MSO_GATEWAY_PROC_NET_TCP6:-/proc/net/tcp6}"; do
    [ -r "$file" ] || continue
    seen=1
    while read -r line; do
      set -- $line; [ "$#" -ge 4 ] || continue
      addr="${2:-}"; state="${4:-}"
      [ "$state" = 0A ] || continue
      case "$addr" in
        *:"$hex") ;;
        *) continue ;;
      esac
      case "$addr" in
        # /proc/net/tcp stores IPv4 bytes little-endian. Every 127/8
        # listener therefore ends in 7F. tcp6 renders ::1 as ...01000000.
        ??????7F:"$hex"|00000000000000000000000001000000:"$hex") ;;
        *) exposed=1 ;;
      esac
    done <"$file"
  done
  [ "$seen" = 1 ] || return 2
  [ "$exposed" = 0 ] || return 0
  return 1
}

gateway_assert_port_loopback_only() {
  local rc
  if gateway_port_exposure_state; then
    gateway_fail "refusing public tunnel: the MSO port already has a non-loopback listener; reconfigure MSO to 127.0.0.1 first"
  else
    rc=$?
    [ "$rc" = 1 ] || gateway_fail "cannot verify kernel listener exposure for the MSO port; refusing public tunnel"
  fi
}
