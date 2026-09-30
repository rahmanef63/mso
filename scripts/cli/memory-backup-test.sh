#!/usr/bin/env bash
set -euo pipefail
source scripts/cli/memory-backup.sh
jget() { printf "%s" "$1"; }
jpost() { printf "%s" "$2"; }
die() { exit 2; }
mso_memory_backup "$@"
