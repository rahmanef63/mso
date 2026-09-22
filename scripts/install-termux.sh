#!/data/data/com.termux/files/usr/bin/bash
# Termux is only the launcher: all MSO tools run in Ubuntu's Linux userspace.
set -Eeuo pipefail
umask 077

DISTRO="${MSO_TERMUX_DISTRO:-mso-ubuntu}"
GUEST_USER="${MSO_TERMUX_USER:-mso}"
IMAGE="${MSO_TERMUX_IMAGE:-ubuntu:24.04}"
INSTALL_URL="${MSO_TERMUX_INSTALL_URL:-https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh}"
TERMUX_BIN="${PREFIX:-/data/data/com.termux/files/usr}/bin"
GUEST_SYSTEM_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

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
  BUN_INSTALL="/home/$GUEST_USER/.bun" LANG=C.UTF-8 TERM="${TERM:-xterm-256color}" \
  /bin/bash --noprofile --norc -c '
  set -Eeuo pipefail
  cd "$HOME"
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
  curl -fsSL "$1" | /bin/bash -s -- --no-service --no-onboard
  [ "$(node -p "process.platform")" = linux ]
  [ "$(bun -p "process.platform")" = linux ]
  command -v mso >/dev/null 2>&1
  mso --version
  mso -h >/dev/null
' bash "$INSTALL_URL"

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
