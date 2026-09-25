#!/usr/bin/env bash
# Owner-only memory snapshots; uses the existing authenticated transport.
mso_memory_backup() {
  case "${1:-preview}" in
    -h|--help|help) printf '%s\n' 'Usage: mso memory-backup preview | create --confirm | verify <id> <manifest-sha256> --confirm' 'Local allowlisted memory snapshot, not a full VPS/database or offsite backup. Verify restores only into a new isolated directory.' ;;
    preview) jget "/api/v1/sys/memory-backup" ;;
    create)
      [ "${2-}" = "--confirm" ] && [ "$#" -eq 2 ] || die "memory-backup create requires --confirm"
      jpost "/api/v1/sys/memory-backup" '{"action":"create","confirm":true}' ;;
    verify)
      [ "$#" -eq 4 ] && [ "${4-}" = "--confirm" ] || die "memory-backup verify requires <id> <manifest-sha256> --confirm"
      jpost "/api/v1/sys/memory-backup" "$(jq -cn --arg id "$2" --arg sha "$3" '{action:"verify",id:$id,manifest_sha256:$sha,confirm:true}')" ;;
    *) die "unknown memory-backup action; run mso memory-backup --help" ;;
  esac
}
