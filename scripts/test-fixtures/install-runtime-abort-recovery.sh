#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:-}"
case "$MODE" in pre|post) ;; *) exit 2 ;; esac

DIR=/tmp
PORT=4005
DO_SERVICE=1
SERVICE=mso.service
die() { printf 'die:%s\n' "$*" >&2; exit 1; }
sudo_do() { printf 'sudo %s\n' "$*" >&3; }
systemd_ready() { return 0; }

# shellcheck source=scripts/lib/install-runtime-lifecycle.sh
. "$ROOT/scripts/lib/install-runtime-lifecycle.sh"
runtime_exclusion_release() { printf 'release-runtime\n' >&3; }
update_gateway_restore_all() { printf 'restore-fallbacks\n' >&3; }
update_lock_release() { printf 'release-update\n' >&3; }

INSTALL_RUNTIME_LIFECYCLE=1
INSTALL_RUNTIME_SERVICE_STOPPED=1
[ "$MODE" = pre ] || install_runtime_lifecycle_mark_mutation_started
install_runtime_lifecycle_cleanup
