#!/data/data/com.termux/files/usr/bin/bash
# MSO bootstrap for Termux/Android.
#
# Supported architecture:
#   Termux host -> Ubuntu PRoot -> normal MSO Linux installer (--no-service)
#
# Native Android/Termux is deliberately not used for the MSO runtime because
# MSO depends on Bun and native Node modules. Keeping the runtime in a normal
# Linux userspace also avoids Android-specific libc/platform mismatches.
set -Eeuo pipefail
umask 077

DISTRO="${MSO_TERMUX_DISTRO:-mso-ubuntu}"
GUEST_USER="${MSO_TERMUX_USER:-mso}"
IMAGE="${MSO_TERMUX_IMAGE:-ubuntu:24.04}"
INSTALL_URL="${MSO_TERMUX_INSTALL_URL:-https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh}"
TERMUX_BIN="${PREFIX:-/data/data/com.termux/files/usr}/bin"

info() { printf '· %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

case "${PREFIX:-}" in
  */com.termux/files/usr) ;;
  *) fail 'run this installer from Termux on Android.' ;;
esac

command -v apt >/dev/null 2>&1 || fail 'Termux apt is missing.'

info 'repairing/updating Termux packages'
if ! apt update; then
  printf '\nRepository update failed. Run `termux-change-repo`, choose a working Main repository, then retry.\n' >&2
  exit 1
fi
DEBIAN_FRONTEND=noninteractive apt full-upgrade -y

# Use apt directly here: when a partial Termux upgrade breaks curl, `pkg` can
# fail before it gets a chance to repair the affected libraries.
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

info 'preparing Ubuntu guest dependencies and non-root MSO owner'
proot-distro login "$DISTRO" -- bash -lc "
  set -Eeuo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y sudo curl ca-certificates git jq coreutils util-linux build-essential python3 passwd
  if ! id -u '$GUEST_USER' >/dev/null 2>&1; then
    useradd -m -s /bin/bash '$GUEST_USER'
  fi
  printf '%s ALL=(ALL) NOPASSWD:ALL\\n' '$GUEST_USER' > '/etc/sudoers.d/$GUEST_USER'
  chmod 0440 '/etc/sudoers.d/$GUEST_USER'
"

info 'installing/updating MSO inside Ubuntu'
proot-distro login "$DISTRO" --user "$GUEST_USER" -- bash -lc "
  set -Eeuo pipefail
  export PATH=\"\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH\"
  curl -fsSL '$INSTALL_URL' | bash -s -- --no-service --no-onboard
  command -v mso >/dev/null 2>&1
  mso --version
  mso -h >/dev/null
"

LAUNCHER="$TERMUX_BIN/mso"
info "installing Termux launcher: $LAUNCHER"
cat > "$LAUNCHER" <<EOF
#!$TERMUX_BIN/bash
set -Eeuo pipefail
exec proot-distro login "$DISTRO" --user "$GUEST_USER" -- bash -lc 'export PATH="\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH"; exec mso "\$@"' bash "\$@"
EOF
chmod 0755 "$LAUNCHER"

ok 'MSO is installed for Termux through Ubuntu PRoot.'
printf '\nVerify:\n'
printf '  mso --version\n'
printf '  mso doctor\n\n'
printf 'Start:\n'
printf '  mso\n'
printf '  mso web\n\n'
printf 'The PRoot environment has no systemd service. The launcher enters the Ubuntu guest automatically.\n'
printf 'YOLO mode is intentionally not enabled by this installer; use `mso --yolo` only when you explicitly want automatic write/exec approval.\n'
