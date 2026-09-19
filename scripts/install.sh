#!/usr/bin/env bash
trap 'rc=$?; trap - EXIT; [ -z "${TMP_INSTALLER:-}" ] || rm -f "$TMP_INSTALLER"; [ -z "${TMP_PLATFORM:-}" ] || rm -f "$TMP_PLATFORM"; if [ "$rc" -eq 0 ]; then printf "mso installer bootstrap ended before verified-core handoff; retry the download.\n" >&2; exit 97; fi; exit "$rc"' EXIT
# MSO public installer bootstrap.
#
# Linux executes the verified Linux installer core. macOS and Android/Termux are
# routed to verified compatibility bootstraps first. Git Bash/MSYS/Cygwin prints
# the supported Windows/WSL2 PowerShell entrypoint instead of pretending Win32
# provides the Linux host primitives MSO requires.
set -Eeuo pipefail
umask 077

RAW_BASE="${MSO_INSTALL_RAW_BASE:-https://raw.githubusercontent.com/rahmanef63/mso/main/scripts}"
CORE_URL="${MSO_INSTALL_CORE_URL:-https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install-core.sh}"
CORE_SHA256="75c1b16303733db3bfe9c787773eea19dbd739f3d6a99abb882f163b3fd83585"
CORE_EOF='# MSO_INSTALLER_CORE_EOF'
MACOS_SHA256="668ec3c8bbf3ee36dc2ae70952c3ba43c6f73ebc3acd6956fa4be2f65a076bfe"
TERMUX_SHA256="27c1a7d558c51ec875d17fd4a02a49e9e309eeb57fb306f62ea8de890ae2e65d"
TMP_INSTALLER=''
TMP_PLATFORM=''


fail() { printf 'mso installer bootstrap: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail 'curl is required.'

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail 'sha256sum or shasum is required to verify installer payloads.'
  fi
}

run_platform_bootstrap() {
  local name="$1" expected="$2" url="$RAW_BASE/$1"
  shift 2
  TMP_PLATFORM="$(mktemp "${TMPDIR:-/tmp}/mso-platform.XXXXXX")"
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 180 "$url" -o "$TMP_PLATFORM" \
    || fail "$name download failed."
  [ "$(sha256_file "$TMP_PLATFORM")" = "$expected" ] || fail "$name hash mismatch (main may have changed during download); retry."
  bash -n "$TMP_PLATFORM" || fail "$name failed shell syntax validation."

  trap - EXIT
  set +e
  bash "$TMP_PLATFORM" "$@"
  local rc=$?
  set -e
  rm -f "$TMP_PLATFORM"
  TMP_PLATFORM=''
  exit "$rc"
}

case "$(uname -s 2>/dev/null || printf unknown)" in
  Darwin)
    run_platform_bootstrap install-macos.sh "$MACOS_SHA256" "$@"
    ;;
  Linux)
    case "${PREFIX:-}" in
      */com.termux/files/usr)
        run_platform_bootstrap install-termux.sh "$TERMUX_SHA256" "$@"
        ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*)
    printf '%s\n' 'MSO on Windows uses WSL2. Open PowerShell and run:'
    printf '%s\n' "iwr -useb $RAW_BASE/install-windows.ps1 | iex"
    exit 64
    ;;
esac

TMP_INSTALLER="$(mktemp "${TMPDIR:-/tmp}/mso-install-core.XXXXXX")"
curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 180 \
  "$CORE_URL" -o "$TMP_INSTALLER" || fail 'installer payload download failed.'

[ "$(wc -c <"$TMP_INSTALLER")" -ge 20000 ] || fail 'installer payload is unexpectedly short; refusing partial execution.'
[ "$(tail -n 1 "$TMP_INSTALLER")" = "$CORE_EOF" ] || fail 'installer payload is incomplete; EOF marker missing.'
ACTUAL_SHA="$(sha256_file "$TMP_INSTALLER")"
[ "$ACTUAL_SHA" = "$CORE_SHA256" ] || fail 'installer payload hash mismatch (main may have changed during download); retry.'
bash -n "$TMP_INSTALLER" || fail 'installer payload failed shell syntax validation.'

# Linux has /proc/self/fd. The Darwin/Android compatibility paths have already
# exited above, so retaining the verified payload by fd keeps the Linux bootstrap
# atomic without adding a second pathname race.
exec 3<"$TMP_INSTALLER"
rm -f "$TMP_INSTALLER"
TMP_INSTALLER=''
exec bash /proc/self/fd/3 "$@"
