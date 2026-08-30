#!/usr/bin/env bash
# MSO one-line installer bootstrap.
#
#   curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
#
# Keep this file intentionally tiny. Streaming a large shell script directly into
# bash can produce a false success if an intermediary closes the response at a
# syntactically complete line. This bootstrap downloads the real installer to a
# private temporary file, proves completeness + SHA-256 + syntax, then executes it.
set -Eeuo pipefail
umask 077

CORE_URL="${MSO_INSTALL_CORE_URL:-https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install-core.sh}"
CORE_SHA256="913350997e568a279c6582e752d38151f20798cb1f1e471b557aba06b71821ad"
CORE_EOF='# MSO_INSTALLER_CORE_EOF'
BOOTSTRAP_DONE=0
TMP_INSTALLER=''

bootstrap_exit() {
  rc=$?
  trap - EXIT
  [ -z "$TMP_INSTALLER" ] || rm -f "$TMP_INSTALLER"
  if [ "$rc" -eq 0 ] && [ "$BOOTSTRAP_DONE" -ne 1 ]; then
    printf 'mso installer bootstrap ended before verification completed; retry the download.\n' >&2
    rc=97
  fi
  exit "$rc"
}
trap bootstrap_exit EXIT

fail() { printf 'mso installer bootstrap: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail 'curl is required.'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum is required to verify the installer payload.'

TMP_INSTALLER="$(mktemp "${TMPDIR:-/tmp}/mso-install-core.XXXXXX")"
# Download FIRST; never execute bytes while they are still arriving.
curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 180   "$CORE_URL" -o "$TMP_INSTALLER" || fail 'installer payload download failed.'

[ "$(wc -c <"$TMP_INSTALLER")" -ge 20000 ] || fail 'installer payload is unexpectedly short; refusing partial execution.'
[ "$(tail -n 1 "$TMP_INSTALLER")" = "$CORE_EOF" ] || fail 'installer payload is incomplete; EOF marker missing.'
ACTUAL_SHA="$(sha256sum "$TMP_INSTALLER" | awk '{print $1}')"
[ "$ACTUAL_SHA" = "$CORE_SHA256" ] || fail 'installer payload hash mismatch (main may have changed during download); retry.'
bash -n "$TMP_INSTALLER" || fail 'installer payload failed shell syntax validation.'

BOOTSTRAP_DONE=1
set +e
bash "$TMP_INSTALLER" "$@"
rc=$?
set -e
exit "$rc"
