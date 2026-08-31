#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/lib/gateway-common.sh
. "$ROOT/scripts/lib/gateway-common.sh"

case "${1:-}" in
  survives)
    gateway_identity_matches() { return 0; }
    kill() { return 0; }
    sleep() { :; }
    gateway_stop_identity '{"pid":4242}'
    ;;
  disappears)
    checks=0
    gateway_identity_matches() { checks=$((checks+1)); [ "$checks" -lt 3 ]; }
    kill() { return 0; }
    sleep() { :; }
    gateway_stop_identity '{"pid":4242}'
    ;;
  *) exit 2 ;;
esac
