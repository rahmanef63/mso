#!/data/data/com.termux/files/usr/bin/bash
# Termux is only the launcher: all MSO tools run in Ubuntu's Linux userspace.
set -Eeuo pipefail
umask 077

DISTRO="${MSO_TERMUX_DISTRO:-mso-ubuntu}"
GUEST_USER="${MSO_TERMUX_USER:-mso}"
IMAGE="${MSO_TERMUX_IMAGE:-ubuntu:24.04}"
GUEST_INSTALL_URL_DEFAULT="https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install-core.sh"
GUEST_INSTALL_SHA256_DEFAULT="794d8893285c045a8ab608d8c1d2803188b4a2a13058695d6c1fd54520973b65"
INSTALL_URL="${MSO_TERMUX_INSTALL_URL:-$GUEST_INSTALL_URL_DEFAULT}"
INSTALL_SHA256="${MSO_TERMUX_INSTALL_SHA256:-$GUEST_INSTALL_SHA256_DEFAULT}"
GUEST_REF="${MSO_TERMUX_REF:-main}"
BUILD_CPUS="${MSO_TERMUX_BUILD_CPUS:-1}"
NODE_HEAP_MB="${MSO_TERMUX_NODE_HEAP_MB:-1536}"
TERMUX_BIN="${PREFIX:-/data/data/com.termux/files/usr}/bin"
GUEST_SYSTEM_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
INSTALL_LOG="${MSO_TERMUX_LOG:-$HOME/.mso/install-termux.log}"

info() { printf '· %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

case "${PREFIX:-}" in
  */com.termux/files/usr) ;;
  *) fail 'run this installer from Termux on Android.' ;;
esac
# These identities also appear in the generated launcher. Never interpolate
# arbitrary shell source (the download URL is passed as a positional argument).
[[ "$DISTRO" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || fail 'invalid distro name.'
[[ "$GUEST_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] && [ "$GUEST_USER" != root ] || fail 'invalid non-root guest user.'
[[ "$GUEST_REF" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ ]] || fail 'invalid MSO ref.'
[[ "$BUILD_CPUS" =~ ^[1-9][0-9]*$ ]] || fail 'MSO_TERMUX_BUILD_CPUS must be a positive integer.'
[[ "$NODE_HEAP_MB" =~ ^[1-9][0-9]*$ ]] || fail 'MSO_TERMUX_NODE_HEAP_MB must be a positive integer.'
if [ -n "${MSO_TERMUX_INSTALL_URL:-}" ] && [ -z "${MSO_TERMUX_INSTALL_SHA256:-}" ]; then
  fail 'MSO_TERMUX_INSTALL_SHA256 is required when overriding MSO_TERMUX_INSTALL_URL.'
fi
[[ "$INSTALL_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail 'MSO_TERMUX_INSTALL_SHA256 must be a lowercase SHA-256 digest.'

mkdir -p "$(dirname "$INSTALL_LOG")"
touch "$INSTALL_LOG"
chmod 600 "$INSTALL_LOG"
if [ "${MSO_TERMUX_NO_TEE:-0}" != 1 ]; then
  exec > >(tee -a "$INSTALL_LOG") 2>&1
fi
info "persistent install log: $INSTALL_LOG"
info "Android-safe build limits: workers=$BUILD_CPUS node-heap=${NODE_HEAP_MB}MiB"

command -v apt >/dev/null 2>&1 || fail 'Termux apt is missing.'
info 'repairing/updating Termux packages'
if ! apt update; then
  printf '\nRepository update failed. Run `termux-change-repo`, choose a working Main repository, then retry.\n' >&2
  exit 1
fi
DEBIAN_FRONTEND=noninteractive apt full-upgrade -y
DEBIAN_FRONTEND=noninteractive apt install -y curl ca-certificates proot-distro
command -v curl >/dev/null 2>&1 || fail 'curl is still unavailable after package repair.'
command -v proot-distro >/dev/null 2>&1 || fail 'proot-distro installation failed.'
curl --version >/dev/null 2>&1 || fail 'curl is installed but cannot start; run `apt update && apt full-upgrade -y` again.'

if proot-distro login "$DISTRO" -- /bin/true >/dev/null 2>&1; then
  info "reusing existing PRoot distro: $DISTRO"
else
  info "installing $IMAGE as $DISTRO"
  proot-distro install "$IMAGE" --name "$DISTRO"
fi

# Reset at the guest boundary, BEFORE starting bash. Unsetting PREFIX alone
# leaves Android PATH, BUN_INSTALL, npm_config_nodedir, LD_PRELOAD, BASH_ENV,
# compiler flags and exported shell functions behind. Login profiles can also
# reintroduce them, so neither installation nor the launcher uses bash -lc.
info 'preparing Ubuntu guest dependencies and non-root MSO owner'
proot-distro login "$DISTRO" -- /usr/bin/env -i \
  HOME=/root USER=root LOGNAME=root SHELL=/bin/bash \
  PATH="$GUEST_SYSTEM_PATH" LANG=C.UTF-8 TERM="${TERM:-xterm-256color}" \
  /bin/bash --noprofile --norc -c '
  set -Eeuo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y sudo curl ca-certificates git jq coreutils util-linux build-essential python3 passwd unzip
  if ! id -u "$1" >/dev/null 2>&1; then
    useradd -m -d "/home/$1" -s /bin/bash "$1"
  fi
  [ "$(getent passwd "$1" | cut -d: -f6)" = "/home/$1" ] || {
    echo "Existing guest user must have home /home/$1; choose another MSO_TERMUX_USER." >&2
    exit 1
  }
  printf "%s ALL=(ALL) NOPASSWD:ALL\n" "$1" > "/etc/sudoers.d/$1"
  chmod 0440 "/etc/sudoers.d/$1"
' bash "$GUEST_USER"

info 'installing/updating MSO inside Ubuntu'
proot-distro login "$DISTRO" --user "$GUEST_USER" -- /usr/bin/env -i \
  HOME="/home/$GUEST_USER" USER="$GUEST_USER" LOGNAME="$GUEST_USER" SHELL=/bin/bash \
  PATH="/home/$GUEST_USER/.local/bin:/home/$GUEST_USER/.bun/bin:$GUEST_SYSTEM_PATH" \
  BUN_INSTALL="/home/$GUEST_USER/.bun" MSO_REF="$GUEST_REF" \
  MSO_BUILD_CPUS="$BUILD_CPUS" MSO_LOW_MEMORY_BUILD=1 \
  NODE_OPTIONS="--max-old-space-size=$NODE_HEAP_MB" MAKEFLAGS="-j$BUILD_CPUS" \
  npm_config_jobs="$BUILD_CPUS" RAYON_NUM_THREADS="$BUILD_CPUS" \
  LANG=C.UTF-8 TERM="${TERM:-xterm-256color}" \
  /bin/bash --noprofile --norc -c '
  set -Eeuo pipefail
  cd "$HOME"
  printf "· guest runtime: "
  uname -m
  grep "^MemTotal:" /proc/meminfo 2>/dev/null | sed "s/^/· guest memory: /" || true
  df -h "$HOME" 2>/dev/null | tail -n 1 | sed "s/^/· guest storage: /" || true
  # Refuse manually linked Android runtimes even on an otherwise clean PATH.
  # Missing tools are installed by the normal Linux installer (NodeSource/Bun).
  for runtime in node bun; do
    if command -v "$runtime" >/dev/null 2>&1; then
      [ "$("$runtime" -p "process.platform")" = linux ] || {
        echo "Non-Linux $runtime in guest PATH; remove the guest Android runtime link and retry." >&2
        exit 1
      }
    fi
  done
  TMP_INSTALLER="$(mktemp "$HOME/.mso-install-core.XXXXXX")"
  cleanup_installer() { rm -f "$TMP_INSTALLER"; }
  trap cleanup_installer EXIT
  curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 180 "$1" -o "$TMP_INSTALLER" || {
    echo "MSO installer payload download failed." >&2
    exit 1
  }
  ACTUAL_SHA256="$(sha256sum "$TMP_INSTALLER")"
  ACTUAL_SHA256="${ACTUAL_SHA256%% *}"
  [ "$ACTUAL_SHA256" = "$2" ] || {
    echo "MSO installer payload hash mismatch; refusing execution." >&2
    exit 1
  }
  /bin/bash -n "$TMP_INSTALLER"
  /bin/bash "$TMP_INSTALLER" --no-service --no-onboard
  cleanup_installer
  trap - EXIT
  [ "$(node -p "process.platform")" = linux ]
  [ "$(bun -p "process.platform")" = linux ]
  command -v mso >/dev/null 2>&1
  mso --version
  mso -h >/dev/null

  # Normal installs must end attached to main so future `mso update` calls work.
  if [ "$MSO_REF" = main ] && [ -d "$HOME/mso/.git" ]; then
    git -C "$HOME/mso" switch -C main origin/main >/dev/null
  fi
' bash "$INSTALL_URL" "$INSTALL_SHA256"

LAUNCHER="$TERMUX_BIN/mso"
info "installing Termux launcher: $LAUNCHER"
# Legacy native-Termux installs used a symlink here pointing into ~/projects/mso.
# Remove the directory entry first so redirection cannot follow that symlink and
# overwrite the legacy checkout target.
rm -f -- "$LAUNCHER"
cat > "$LAUNCHER" <<EOF
#!$TERMUX_BIN/bash
set -Eeuo pipefail
exec proot-distro login "$DISTRO" --user "$GUEST_USER" -- /usr/bin/env -i \\
  HOME="/home/$GUEST_USER" USER="$GUEST_USER" LOGNAME="$GUEST_USER" SHELL=/bin/bash \\
  PATH="/home/$GUEST_USER/.local/bin:/home/$GUEST_USER/.bun/bin:$GUEST_SYSTEM_PATH" \\
  BUN_INSTALL="/home/$GUEST_USER/.bun" LANG=C.UTF-8 TERM="\${TERM:-xterm-256color}" \\
  /bin/bash --noprofile --norc -c 'cd "\$HOME"; exec mso "\$@"' bash "\$@"
EOF
chmod 0755 "$LAUNCHER"

ok 'MSO is installed for Termux through Ubuntu PRoot.'
printf '\nVerify:\n  mso --version\n  mso doctor\n\nStart:\n  mso\n  mso web\n\n'
printf 'The PRoot environment has no systemd service. The launcher enters the Ubuntu guest automatically.\n'
printf 'YOLO mode is intentionally not enabled by this installer; use `mso --yolo` only when you explicitly want automatic write/exec approval.\n'
