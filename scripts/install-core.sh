#!/usr/bin/env bash
# mso (Manef Shell OS) installer core — fetched and verified by scripts/install.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
#
# Idempotent: re-running updates the checkout, rebuilds, and restarts the
# service. The bootstrap never needs stdin, so curl|bash stays safe. After a
# FRESH install it uses /dev/tty (when present) for guided onboarding; CI/headless
# installs never hang and can run `mso onboard` later. Existing .env.local is preserved.
set -Eeuo pipefail

# ---- config: env override > flag > default ----
REPO_URL="${MSO_REPO:-https://github.com/rahmanef63/mso.git}"
DIR="${MSO_DIR:-$HOME/mso}"
DIR_EXPLICIT=0
REF="${MSO_REF:-main}"
PORT="${MSO_PORT:-4005}"
# Address the server listens on. Loopback by DEFAULT, for two reasons that point
# the same way:
#   1. It cannot log in otherwise. sessionCookieAttrs() sets `secure: true`
#      (lib/auth/session-cookie.ts), and a browser only accepts a Secure cookie
#      over plain http on a trustworthy origin — localhost / 127.0.0.1 / ::1. So
#      http://<lan-or-public-ip>:PORT returns 200 on login and then silently
#      drops the cookie: an endless login loop. A 0.0.0.0 bind buys no working
#      access it did not already have.
#   2. It is a shell. An authenticated session runs commands as this user, and a
#      fresh VPS has ufw installed but disabled — so the old default published
#      that shell to the whole internet about two minutes into a curl|bash.
# Reach it over an SSH tunnel, `tailscale serve`, or a reverse proxy on this host
# (all three land the browser on a trustworthy origin, so the cookie sticks).
BIND="${MSO_BIND:-127.0.0.1}"
SERVICE="mso.service"
DO_SERVICE=1
DO_UNINSTALL=0
YES=0
ONBOARD_MODE=auto
FRESH_INSTALL=0
# bun is the package manager; the RUNTIME stays node (see ensure_bun below).
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
# Capture the INVOKING shell PATH before Bun or the installer changes it. A child
# curl|bash process cannot export back into its parent, so this is the only PATH
# that matters when proving `mso -h` will resolve immediately after we return.
PARENT_PATH="${PATH:-}"
PARENT_CWD="$PWD"
SERVICE_READY=0
SERVICE_ATTEMPTED=0
# Reproducible bootstrap: this is Bun v1.3.14's installer source, pinned by
# immutable Git commit and verified before execution. Update both values together.
BUN_BOOTSTRAP_COMMIT="0d9b296af33f2b851fcbf4df3e9ec89751734ba4"
BUN_BOOTSTRAP_SHA256="bab8acfb046aac8c72407bdcce903957665d655d7acaa3e11c7c4616beae68dd"

# ---- pretty output (tty + NO_COLOR aware) ----
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else
  C_OK=; C_WARN=; C_ERR=; C_DIM=; C_RST=
fi
info() { printf '%s·%s %s\n' "$C_DIM"  "$C_RST" "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_OK"   "$C_RST" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_RST" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$C_ERR"  "$C_RST" "$*" >&2; exit 1; }

# `curl | bash` historically allowed a truncated stream to end at a syntactically
# complete line and look successful. The public bootstrap now downloads + hashes
# this complete file first. This phase-only ERR trap handles genuine runtime
# failures without echoing commands that may contain credentials.
INSTALL_PHASE=arguments
trap 'rc=$?; printf "%s✗%s mso installer failed during %s (line %s, exit %s)\n" "$C_ERR" "$C_RST" "$INSTALL_PHASE" "$LINENO" "$rc" >&2' ERR

usage() {
  cat <<EOF
mso installer
  --dir PATH     install dir (default: \$HOME/mso, or an existing service's dir)
  --ref REF      git ref/branch/tag to check out (default: main)
  --port N       listen port (default: 4005)
  --bind ADDR    listen address (default: 127.0.0.1). 0.0.0.0 publishes a shell
                 to every network this host is on — see the note in this file.
  --no-service   build only; skip the systemd unit
  --onboard      run guided onboarding even on an existing install
  --no-onboard   never start onboarding automatically
  -y, --yes      safe non-interactive defaults (no external accounts/apps/skills)
  --uninstall    stop+disable+remove the systemd unit (keeps code + ~/.mso)
  -h, --help     this help
Env: MSO_DIR  MSO_REF  MSO_PORT  MSO_BIND  MSO_REPO
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)        DIR="$2"; DIR_EXPLICIT=1; shift 2 ;;
    --ref)        REF="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --bind)       BIND="$2"; shift 2 ;;
    --no-service) DO_SERVICE=0; shift ;;
    --onboard)    ONBOARD_MODE=always; shift ;;
    --no-onboard) ONBOARD_MODE=never; shift ;;
    -y|--yes)     YES=1; shift ;;
    --uninstall)  DO_UNINSTALL=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *)            die "unknown arg: $1 (see --help)" ;;
  esac
done

INSTALL_PHASE=preflight
# ---- never as root: an authed session gets shell as this user ----
[ "$(id -u)" -ne 0 ] || die "run as your normal NON-root user, not root (mso runs shell as the process user)."

sudo_do() { if command -v sudo >/dev/null 2>&1; then sudo "$@"; else die "need root for: $* (install sudo or run the step by hand)"; fi; }

is_wsl() {
  grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null || grep -qi microsoft /proc/version 2>/dev/null
}

systemd_ready() {
  command -v systemctl >/dev/null 2>&1 || return 1
  [ -r /proc/1/comm ] || return 1
  [ "$(tr -d '\n' </proc/1/comm 2>/dev/null)" = "systemd" ]
}

path_has_dir() {
  case ":$1:" in *":$2:"*) return 0 ;; *) return 1 ;; esac
}

# PATH entries are resolved by the caller relative to the caller's cwd. The
# installer later cd's into the checkout, so replaying a raw relative PATH there
# would prove the wrong shell. Convert each entry to the directory the parent
# shell will actually search after this child returns. Empty entries mean cwd.
normalize_parent_path() {
  local raw="$1" cwd="$2" out="" entry last=0
  while [ "$last" -eq 0 ]; do
    case "$raw" in
      *:*) entry="${raw%%:*}"; raw="${raw#*:}" ;;
      *) entry="$raw"; raw=""; last=1 ;;
    esac
    case "$entry" in
      "") entry="$cwd" ;;
      /*) ;;
      *) entry="$cwd/$entry" ;;
    esac
    if [ -n "$out" ]; then out="$out:$entry"; else out="$entry"; fi
  done
  printf '%s' "$out"
}

# Create/update one CLI symlink without ever replacing an unrelated command.
# Returns nonzero when the destination is unavailable; callers decide whether that
# is fatal (the user-local launcher is) or only affects current-shell discovery.
link_cli_guarded() {
  local link="$1" target="$2" current dir
  dir="$(dirname "$link")"
  [ -d "$dir" ] || return 1
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    warn "$link already exists and is not a symlink — left untouched"
    return 1
  fi
  if [ -L "$link" ]; then
    current="$(readlink "$link")"
    case "$current" in
      "$DIR/"*) ;;
      *) warn "$link already points elsewhere ($current) — left untouched"; return 1 ;;
    esac
  fi
  if [ -w "$dir" ]; then
    ln -sfn "$target" "$link"
  elif command -v sudo >/dev/null 2>&1; then
    sudo ln -sfn "$target" "$link" || return 1
  else
    return 1
  fi
}

# If a service already exists, update IT in place (unless --dir was given) — so a
# re-run never spins up a divergent second copy next to a working install.
if [ "$DIR_EXPLICIT" -eq 0 ] && systemd_ready; then
  existing="$(systemctl show -p WorkingDirectory --value "$SERVICE" 2>/dev/null || true)"
  [ -n "$existing" ] && [ -d "$existing/.git" ] && DIR="$existing" && info "found existing service → updating $DIR"
fi
[ -d "$DIR/.git" ] || FRESH_INSTALL=1

# ---- uninstall ----
if [ "$DO_UNINSTALL" -eq 1 ]; then
  # Guarded: without this, --uninstall on a box that never had the unit still
  # asks for a sudo password and then claims to have removed something.
  if command -v systemctl >/dev/null 2>&1 && [ -f "/etc/systemd/system/$SERVICE" ]; then
    sudo_do systemctl disable --now "$SERVICE" 2>/dev/null || true
    sudo_do rm -f "/etc/systemd/system/$SERVICE"
    sudo_do systemctl daemon-reload
    ok "removed $SERVICE"
  else
    info "no $SERVICE installed — nothing to remove"
  fi

  # Take back the symlinks this script created. Both are resolved and compared
  # against $DIR first, so a hand-made `mso` on PATH or a third-party skill of
  # the same name is never touched.
  UNINST_BIN="${MSO_BIN_DIR:-$HOME/.local/bin}/mso"
  if [ -L "$UNINST_BIN" ] && case "$(readlink "$UNINST_BIN")" in "$DIR/"*) true ;; *) false ;; esac; then
    rm -f "$UNINST_BIN"; ok "removed cli symlink $UNINST_BIN"
  fi
  UNINST_SYSTEM_CLI="${MSO_SYSTEM_BIN_DIR:-/usr/local/bin}/mso"
  if [ -L "$UNINST_SYSTEM_CLI" ] && case "$(readlink "$UNINST_SYSTEM_CLI")" in "$DIR/"*) true ;; *) false ;; esac; then
    if [ -w "$(dirname "$UNINST_SYSTEM_CLI")" ]; then rm -f "$UNINST_SYSTEM_CLI"
    else sudo_do rm -f "$UNINST_SYSTEM_CLI"; fi
    ok "removed cli symlink $UNINST_SYSTEM_CLI"
  fi
  UNINST_SKILLS="${MSO_SKILL_DIR:-$HOME/.claude/skills}"
  if [ -d "$UNINST_SKILLS" ]; then
    for l in "$UNINST_SKILLS"/*; do
      [ -L "$l" ] || continue
      case "$(readlink "$l")" in "$DIR/claude-skills/"*) rm -f "$l"; info "removed skill $(basename "$l")" ;; esac
    done
  fi

  info "code left at $DIR and data at ~/.mso — delete by hand if you want them gone."
  exit 0
fi

INSTALL_PHASE=prerequisites
# ---- prereqs ----
ensure_git() {
  command -v git >/dev/null 2>&1 && return
  info "installing git…"
  if   command -v apt-get >/dev/null 2>&1; then sudo_do apt-get update -qq && sudo_do apt-get install -y -qq git
  elif command -v dnf     >/dev/null 2>&1; then sudo_do dnf install -y -q git
  elif command -v pacman  >/dev/null 2>&1; then sudo_do pacman -Sy --noconfirm git
  else die "git missing and no known package manager — install git and re-run."; fi
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const[a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)'
}
ensure_node() {
  node_ok && { info "node $(node -v) ok"; return; }
  warn "Node >=20.9 not found"
  if command -v apt-get >/dev/null 2>&1; then
    info "installing Node 22 via NodeSource…"
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo_do -E bash -
    sudo_do apt-get install -y -qq nodejs
  else
    die "install Node >=20.9 (22 recommended) from https://nodejs.org or your distro, then re-run."
  fi
  node_ok || die "Node still <20.9 after install."
}

# bun installs dependencies; it does NOT run the app. `next start` stays on node
# (see the unit's ExecStart below) because node-pty's binding is built against
# node's ABI and the whole /api/v1 surface imports it.
ensure_bun() {
  command -v bun >/dev/null 2>&1 && { info "bun $(bun -v) ok"; return; }
  command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required to verify the Bun bootstrap."
  info "installing Bun from a pinned, verified bootstrap…"
  local bootstrap actual url
  bootstrap="$(mktemp)"
  url="https://raw.githubusercontent.com/oven-sh/bun/$BUN_BOOTSTRAP_COMMIT/src/cli/install.sh"
  curl -fsSL "$url" -o "$bootstrap" || { rm -f "$bootstrap"; die "Bun bootstrap download failed."; }
  actual="$(sha256sum "$bootstrap" | awk '{print $1}')"
  [ "$actual" = "$BUN_BOOTSTRAP_SHA256" ] || {
    rm -f "$bootstrap"
    die "Bun bootstrap integrity check failed."
  }
  bash "$bootstrap" >/dev/null 2>&1 || { rm -f "$bootstrap"; die "bun install failed."; }
  rm -f "$bootstrap"
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "bun installed but not on PATH — add $BUN_INSTALL/bin."
}

ensure_buildtools() {
  # node-pty is a native addon with no linux prebuild → needs a C/C++ toolchain +
  # python3 to compile at install time, under bun exactly as under pnpm.
  # This is the single most likely install failure on a minimal box.
  command -v cc >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 && return
  info "installing build toolchain (for node-pty)…"
  if   command -v apt-get >/dev/null 2>&1; then sudo_do apt-get update -qq && sudo_do apt-get install -y -qq build-essential python3
  elif command -v dnf     >/dev/null 2>&1; then sudo_do dnf install -y -q gcc-c++ make python3
  elif command -v pacman  >/dev/null 2>&1; then sudo_do pacman -Sy --noconfirm base-devel python
  else warn "no known package manager — if 'bun install' fails on node-pty, install a C++ toolchain + python3 by hand."; fi
}

ensure_cli_tools() {
  # bin/mso uses jq for JSON shaping, coreutils for guarded file identity, and
  # util-linux flock for crash-safe gateway/update transaction locks.
  # A pristine WSL/Ubuntu image may have Node+Bun but no jq. Install these before
  # creating the launcher so `mso -h` is a real installer postcondition.
  local missing=0 tool
  for tool in curl jq realpath stat mktemp sha256sum flock; do
    command -v "$tool" >/dev/null 2>&1 || { missing=1; break; }
  done
  [ "$missing" -eq 0 ] && return
  info "installing CLI runtime tools (curl, jq, coreutils, util-linux)…"
  if   command -v apt-get >/dev/null 2>&1; then sudo_do apt-get update -qq && sudo_do apt-get install -y -qq curl jq coreutils util-linux
  elif command -v dnf     >/dev/null 2>&1; then sudo_do dnf install -y -q curl jq coreutils util-linux
  elif command -v pacman  >/dev/null 2>&1; then sudo_do pacman -Sy --noconfirm curl jq coreutils util-linux
  else die "mso CLI needs curl, jq, realpath, stat, mktemp, sha256sum and flock; install the missing tools, then rerun."; fi
  for tool in curl jq realpath stat mktemp sha256sum flock; do
    command -v "$tool" >/dev/null 2>&1 || die "CLI runtime dependency still missing after package install: $tool"
  done
}

ensure_git; ensure_node; ensure_bun; ensure_buildtools; ensure_cli_tools

# Existing checkouts already ship the private-state primitive. Hold the SAME
# checkout-scoped transaction.lock used by `mso update`/`mso deploy` before Git
# fetch/checkout mutates source. The FD stays open and is adopted by the freshly
# checked-out lifecycle helper, so there is no unlock/relock window.
INSTALL_EARLY_UPDATE_LOCK_HELD=0
INSTALL_EARLY_UPDATE_LOCK_FD=''
INSTALL_EARLY_UPDATE_LOCK_FILE=''
INSTALL_EARLY_UPDATE_CANONICAL_ROOT=''

install_private_state_dir() {
  local requested="${1:-}" created=0 canonical owner mode old_umask
  [ -n "$requested" ] || die "empty installer private-state directory"
  case "$requested" in /*) ;; *) die "installer private-state directory must be absolute: $requested" ;; esac
  [ ! -L "$requested" ] || die "refusing symlink installer private-state directory: $requested"
  if [ ! -e "$requested" ]; then old_umask=$(umask); umask 077; mkdir -p -- "$requested"; umask "$old_umask"; created=1; fi
  [ -d "$requested" ] && [ ! -L "$requested" ] || die "not a real installer private-state directory: $requested"
  canonical="$(realpath -e -- "$requested" 2>/dev/null || true)"; [ -n "$canonical" ] || die "cannot resolve installer private-state directory: $requested"
  owner="$(stat -c '%u' -- "$canonical" 2>/dev/null || true)"; mode="$(stat -c '%a' -- "$canonical" 2>/dev/null || true)"
  [ "$owner" = "$(id -u)" ] || die "installer private-state directory is not owned by current uid: $canonical"
  if [ "$created" = 1 ]; then chmod 700 -- "$canonical"; mode="$(stat -c '%a' -- "$canonical")"; fi
  [ "$mode" = 700 ] || die "installer private-state directory must be mode 0700, got $mode: $canonical"
  printf '%s' "$canonical"
}

install_private_state_ensure_file() {
  local requested="$1" parent name canonical_parent resolved tmp old_umask owner mode
  parent="$(dirname -- "$requested")"; name="$(basename -- "$requested")"
  [ -n "$name" ] && [ "$name" != . ] && [ "$name" != / ] || die "invalid installer private-state file: $requested"
  canonical_parent="$(install_private_state_dir "$parent")"; resolved="$canonical_parent/$name"
  if [ -e "$resolved" ] || [ -L "$resolved" ]; then
    [ ! -L "$resolved" ] && [ -f "$resolved" ] || die "unsafe installer private-state lock: $resolved"
    owner="$(stat -c '%u' -- "$resolved" 2>/dev/null || true)"; mode="$(stat -c '%a' -- "$resolved" 2>/dev/null || true)"
    [ "$owner" = "$(id -u)" ] && [ "$mode" = 600 ] || die "installer private-state lock must be owner mode 0600: $resolved"
    printf '%s' "$resolved"; return 0
  fi
  old_umask=$(umask); umask 077; tmp="$(mktemp "$canonical_parent/.mso-install-lock.XXXXXX")"; umask "$old_umask"; chmod 600 -- "$tmp"
  if ! mv -Tn -- "$tmp" "$resolved"; then rm -f -- "$tmp"; fi
  [ ! -L "$resolved" ] && [ -f "$resolved" ] || die "could not create safe installer private-state lock: $resolved"
  owner="$(stat -c '%u' -- "$resolved" 2>/dev/null || true)"; mode="$(stat -c '%a' -- "$resolved" 2>/dev/null || true)"
  [ "$owner" = "$(id -u)" ] && [ "$mode" = 600 ] || die "installer private-state lock must be owner mode 0600: $resolved"
  printf '%s' "$resolved"
}

install_early_update_lock_release() {
  [ "$INSTALL_EARLY_UPDATE_LOCK_HELD" = 1 ] || return 0
  if [ -n "${INSTALL_EARLY_UPDATE_LOCK_FD:-}" ]; then flock -u "$INSTALL_EARLY_UPDATE_LOCK_FD" 2>/dev/null || true; exec {INSTALL_EARLY_UPDATE_LOCK_FD}>&- || true; INSTALL_EARLY_UPDATE_LOCK_FD=''; fi
  INSTALL_EARLY_UPDATE_LOCK_HELD=0
}

install_early_update_lock_acquire() {
  local canonical base key state lock timeout
  [ -d "$DIR/.git" ] || return 0
  [ -z "$(git -C "$DIR" status --porcelain)" ] || die "checkout has uncommitted changes at $DIR; refusing an unlocked in-place upgrade"
  canonical="$(realpath -e -- "$DIR" 2>/dev/null || true)"; [ -n "$canonical" ] || die "cannot canonicalize existing checkout before update lock"
  base="$(install_private_state_dir "${MSO_UPDATE_STATE_DIR:-$HOME/.mso/private/update-state}")"
  key="$(printf '%s' "$canonical" | sha256sum | awk '{print $1}')"; [[ "$key" =~ ^[0-9a-f]{64}$ ]] || die "cannot derive installer update-lock scope"
  state="$(install_private_state_dir "$base/$key")"; lock="$(install_private_state_ensure_file "$state/transaction.lock")"
  exec {INSTALL_EARLY_UPDATE_LOCK_FD}<>"$lock" || die "cannot open installer update transaction lock"
  timeout="${MSO_UPDATE_LOCK_TIMEOUT_SECONDS:-900}"; [[ "$timeout" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "invalid installer update-lock timeout"
  if ! flock -x -w "$timeout" "$INSTALL_EARLY_UPDATE_LOCK_FD"; then exec {INSTALL_EARLY_UPDATE_LOCK_FD}>&- || true; INSTALL_EARLY_UPDATE_LOCK_FD=''; die "another MSO installer/update/deploy transaction is still running for $canonical"; fi
  INSTALL_EARLY_UPDATE_LOCK_HELD=1; INSTALL_EARLY_UPDATE_LOCK_FILE="$lock"; INSTALL_EARLY_UPDATE_CANONICAL_ROOT="$canonical"; trap install_early_update_lock_release EXIT
}

install_early_update_lock_acquire

# portable 32-byte hex RNG (node is guaranteed present by now)
rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else node -e "process.stdout.write(require('crypto').randomBytes($1).toString('hex'))"; fi
}

rand_password() {
  node -e 'const c="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";const b=require("crypto").randomBytes(24);let s="";for(const x of b)s+=c[x%c.length];process.stdout.write(s)'
}

INSTALL_PHASE=checkout
# ---- clone or update (idempotent, resilient to a dirty tree) ----
if [ -d "$DIR/.git" ]; then
  info "updating existing checkout at $DIR"
  old_commit="$(git -C "$DIR" rev-parse --short HEAD)"
  if [ -n "$(git -C "$DIR" status --porcelain)" ]; then
    die "checkout has uncommitted changes at $DIR. Commit/stash them, or install into another --dir. Current commit: $old_commit"
  fi
  info "current commit: $old_commit"
  git -C "$DIR" fetch --quiet origin "$REF" || die "could not fetch origin $REF"
  target_commit="$(git -C "$DIR" rev-parse --short FETCH_HEAD)" || die "could not resolve fetched ref $REF"
  info "target commit:  $target_commit"
  git -C "$DIR" checkout --quiet FETCH_HEAD || die "could not check out $target_commit"
  ok "updated checkout $old_commit → $(git -C "$DIR" rev-parse --short HEAD)"
else
  info "cloning $REPO_URL → $DIR"
  git clone --quiet --branch "$REF" "$REPO_URL" "$DIR" 2>/dev/null || git clone --quiet "$REPO_URL" "$DIR"
fi
cd "$DIR"

# ---- post-checkout phases ----
# Fresh installs have the requested checkout now, so the rest of the installer is
# split into bounded repo-owned phases without adding bootstrap downloads.
for phase in cli runtime-build service finalize; do
  module="$DIR/scripts/install/$phase.sh"
  [ -f "$module" ] || die "installer phase missing from checkout: $module"
  # shellcheck source=/dev/null
  . "$module"
done

INSTALL_PHASE=complete
# MSO_INSTALLER_CORE_EOF
