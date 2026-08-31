#!/usr/bin/env bash
# Hold a newly-forked tunnel child until its parent records PID/start-ticks.
# If the parent disappears before release, exit instead of orphaning a tunnel.
set -euo pipefail

parent_pid="${1:-}"; parent_ticks="${2:-}"; gate="${3:-}"; shift 3 || exit 2
[[ "$parent_pid" =~ ^[0-9]+$ && "$parent_ticks" =~ ^[0-9]+$ ]] || exit 2
case "$gate" in /*) ;; *) exit 2 ;; esac
[ "$#" -gt 0 ] || exit 2
cmd=("$@")

for ((i=0; i<500; i++)); do
  if [ -f "$gate" ] && [ ! -L "$gate" ]; then
    [ "$(stat -c '%u' -- "$gate" 2>/dev/null || true)" = "$(id -u)" ] || exit 126
    [ "$(stat -c '%a' -- "$gate" 2>/dev/null || true)" = 600 ] || exit 126
    exec "${cmd[@]}"
  fi

  [ -r "/proc/$parent_pid/stat" ] || exit 125
  IFS= read -r line <"/proc/$parent_pid/stat" || exit 125
  rest="${line##*) }"; set -- $rest
  [ "${20:-}" = "$parent_ticks" ] || exit 125
  sleep 0.01
done
exit 124
