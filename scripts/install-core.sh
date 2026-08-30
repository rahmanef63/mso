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

INSTALL_PHASE=cli
# ---- CLI on PATH (before deps/build/service so a partial WSL install still gets a CLI) ----
# The web UI is one frontend; bin/mso reaches the same /api surface from a shell.
BIN_DIR="${MSO_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN_DIR"
ln -sfn "$DIR/bin/mso" "$BIN_DIR/mso"
ok "cli → $BIN_DIR/mso"

# A fresh distro/WSL home often omits ~/.local/bin from the current PATH. Persist
# one small idempotent block for future shells. Default to bash when SHELL is not
# exported (common in curl|bash/cloud-init); zsh gets its own rc instead.
path_block() {
  local rc="$1"
  [ -e "$rc" ] || : > "$rc"
  grep -q '^# >>> mso cli >>>$' "$rc" 2>/dev/null && return
  cat >> "$rc" <<'EOF'

# >>> mso cli >>>
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
# <<< mso cli <<<
EOF
  info "added ~/.local/bin to PATH in $rc"
}
if [ "$BIN_DIR" = "$HOME/.local/bin" ]; then
  path_block "$HOME/.profile"
  case "${SHELL:-/bin/bash}" in
    */zsh) path_block "$HOME/.zshrc" ;;
    *)     path_block "$HOME/.bashrc" ;;
  esac
else
  warn "custom MSO_BIN_DIR=$BIN_DIR is not written into shell profiles; add it to PATH yourself"
fi

# Prove discoverability from the PARENT shell's original PATH. If the user-local
# directory was already there, nothing else is needed. Otherwise use a guarded
# launcher in /usr/local/bin (or MSO_SYSTEM_BIN_DIR) only when that directory is
# already on the invoking PATH. This also makes `--no-service` useful on WSL.
PARENT_PATH_RESOLVED="$(normalize_parent_path "$PARENT_PATH" "$PARENT_CWD")"
SYSTEM_BIN_DIR="${MSO_SYSTEM_BIN_DIR:-/usr/local/bin}"
case "$SYSTEM_BIN_DIR" in /*) ;; *) SYSTEM_BIN_DIR="$PARENT_CWD/$SYSTEM_BIN_DIR" ;; esac
SYSTEM_CLI="$SYSTEM_BIN_DIR/mso"
TARGET_CLI_REAL="$(readlink -f "$DIR/bin/mso")"
CLI_IMMEDIATE=0
parent_cli="$(PATH="$PARENT_PATH_RESOLVED" command -v mso 2>/dev/null || true)"
if [ -n "$parent_cli" ] && [ "$(readlink -f "$parent_cli" 2>/dev/null || true)" = "$TARGET_CLI_REAL" ]; then
  CLI_IMMEDIATE=1
elif path_has_dir "$PARENT_PATH_RESOLVED" "$SYSTEM_BIN_DIR"; then
  if link_cli_guarded "$SYSTEM_CLI" "$DIR/bin/mso"; then
    ok "current-PATH cli → $SYSTEM_CLI"
    parent_cli="$(PATH="$PARENT_PATH_RESOLVED" command -v mso 2>/dev/null || true)"
    if [ -n "$parent_cli" ] && [ "$(readlink -f "$parent_cli" 2>/dev/null || true)" = "$TARGET_CLI_REAL" ]; then
      CLI_IMMEDIATE=1
    fi
  else
    warn "could not install $SYSTEM_CLI; the user CLI is still installed at $BIN_DIR/mso"
  fi
else
  info "$SYSTEM_BIN_DIR is not on the invoking PATH — skipped the extra launcher"
fi

# Validate the actual launcher independently of PATH. The child installer may use
# its own exported PATH for onboarding, but that is NOT treated as proof that the
# parent shell can see the command.
[ -x "$BIN_DIR/mso" ] || die "CLI launcher target is not executable: $BIN_DIR/mso"
"$BIN_DIR/mso" -h >/dev/null 2>&1 || die "CLI launcher self-check failed: $BIN_DIR/mso (verify curl/jq/coreutils and rerun)"
export PATH="$BIN_DIR:$PATH"
if [ "$CLI_IMMEDIATE" -eq 1 ]; then
  ok "mso -h will resolve immediately after the installer returns ($parent_cli)"
else
  warn "mso is installed, but this shell's existing PATH cannot see it yet"
  warn "for this shell run: export PATH=\"$BIN_DIR:\$PATH\""
  if [ "$BIN_DIR" = "$HOME/.local/bin" ]; then
    info "future shells will load the persisted ~/.local/bin PATH block"
  else
    warn "custom MSO_BIN_DIR is not persisted automatically; add $BIN_DIR to your shell profile"
  fi
fi


INSTALL_PHASE=runtime-safety
# ---- freeze every runtime that can read this checkout before dependency/build mutation ----
# The lifecycle remains open through service refresh. A pre-mutation abort restores the
# known-good service/fallbacks; after mutation starts EXIT preserves recovery intent and
# never serves the possibly changed tree.
# shellcheck source=scripts/lib/install-runtime-lifecycle.sh
. "$DIR/scripts/lib/install-runtime-lifecycle.sh"
trap install_runtime_lifecycle_cleanup EXIT
trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
install_runtime_lifecycle_begin

INSTALL_PHASE=dependencies
# ---- deps (compiles node-pty) ----
info "installing dependencies…"
install_runtime_lifecycle_mark_mutation_started
bun install --frozen-lockfile || bun install

INSTALL_PHASE=configuration
# ---- data dir + secrets (write .env.local only if absent) ----
mkdir -p "$HOME/.mso" && chmod 700 "$HOME/.mso"

GEN_PW=""
if [ ! -f .env.local ]; then
  SECRET="$(rand_hex 32)"
  GEN_PW="$(rand_password)"
  ( umask 077
    cat > .env.local <<EOF
# mso — generated by install.sh. Private; NEVER commit.
OS_LOGIN_PASSWORD=$GEN_PW
OS_SESSION_SECRET=$SECRET
# SESSION_EXPIRY_HOURS=24
# OS_FS_READ_ROOTS=~:~/projects
# OS_FS_WRITE_ROOTS=~:~/projects
# OS_AUDIT_LOG=~/.mso/audit.log
EOF
  )
  chmod 600 .env.local
  ok "wrote .env.local (login password + session secret generated)"
else
  info ".env.local exists — left untouched (existing secrets preserved)"
fi

INSTALL_PHASE=build
# ---- build ----
# Do not invoke Next through `bun run build` here. Bun resolves package binaries
# through node_modules/.bin metadata, and Bun 1.3.x can occasionally leave that
# metadata unreadable on WSL even when node_modules/next itself is intact. The
# package entrypoint is ordinary Node.js, so invoke it directly and bypass the
# remapper entirely. Only force-reinstall when the package payload itself is absent.
NEXT_BIN="$DIR/node_modules/next/dist/bin/next"
if [ ! -f "$NEXT_BIN" ]; then
  warn "Next.js package entrypoint is missing after bun install — repairing dependencies once…"
  bun install --force --frozen-lockfile || bun install --force
fi
[ -f "$NEXT_BIN" ] || die "Next.js package entrypoint is still missing after dependency repair: $NEXT_BIN"
info "building (next build via Node entrypoint)…"
node "$NEXT_BIN" build

INSTALL_PHASE=service
# ---- systemd unit ----
if [ "$DO_SERVICE" -eq 1 ] && systemd_ready; then
  SERVICE_ATTEMPTED=1
  # Start via npm (always on PATH, ships with node) to match the proven prod unit;
  # PORT/HOSTNAME are set as env too so `next start` binds correctly regardless.
  NPM_BIN="$(command -v npm)"
  RUNTIME_INSTANCE_ID="$(rand_hex 16)"
  info "installing $SERVICE (needs sudo)…"
  sudo_do tee "/etc/systemd/system/$SERVICE" >/dev/null <<EOF
[Unit]
Description=Manef Shell OS — browser-based visual shell for a Linux server
After=network.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env.local
Environment=PORT=$PORT
Environment=HOSTNAME=$BIND
# Fresh on every installer-driven restart. /api/health echoes this non-secret nonce
# so readiness proves the HTTP response came from THIS restarted unit, not a stale
# process that happened to keep answering on the configured port.
Environment=MSO_RUNTIME_INSTANCE_ID=$RUNTIME_INSTANCE_ID
# A system unit with User= inherits no login session, so it gets no user-bus
# address and every \`systemctl --user\` it runs answers "Failed to connect to bus:
# No medium found". That silently broke the managed-app installs (which create
# systemd USER units) and made installed apps read as "not installed". Paired with
# the \`loginctl enable-linger\` below, without which /run/user/<uid> is destroyed
# at logout.
#
# The UID IS WRITTEN OUT, NOT the %U specifier. Do not "tidy" this back to %U — it
# was tried and it FAILS: with User=antinrml and UID=1000, systemd 255 expanded %U
# to 0, so the unit got XDG_RUNTIME_DIR=/run/user/0 and every systemctl --user
# answered "No such file or directory" — the original bug wearing a new message.
# Specifiers are expanded while the unit is parsed, before the NAME in User= has
# been resolved to a uid, so %U falls back to the manager's own uid (root).
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u)
# systemd would otherwise give this unit only
# /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin. Both managed-app CLIs install
# themselves into ~/.local/bin, so without this \`which hermes\` fails inside the
# service on a host where it plainly works in a terminal.
Environment=PATH=$HOME/.local/bin:$HOME/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$NPM_BIN run start -- --hostname $BIND --port $PORT
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20
MemoryMax=3G
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mso

[Install]
WantedBy=multi-user.target
EOF
  # A wildcard bind is not an address you can dial; probe loopback instead.
  HEALTH_HOST="$BIND"
  case "$BIND" in 0.0.0.0|::|"") HEALTH_HOST=127.0.0.1 ;; esac

  # Makes /run/user/<uid> — where the user bus lives — exist without a login
  # session and survive logout. The XDG_RUNTIME_DIR above names that directory, so
  # without linger it would point at nothing after the installing shell exits.
  # Idempotent; failure is not fatal, it only means managed-app installs will say
  # so plainly when they preflight the bus.
  sudo_do loginctl enable-linger "$(id -un)" >/dev/null 2>&1 \
    || warn "could not enable linger for $(id -un) — self-update and managed-app user services may stop after logout"
  # `enable-linger` makes the manager persistent, but some minimal images do not
  # start user@UID.service until the next login. Start it now so the first update
  # button works immediately, then prove the bus MSO will use actually answers.
  sudo_do systemctl start "user@$(id -u).service" >/dev/null 2>&1 \
    || warn "could not start the per-user systemd manager — self-update may be unavailable"
  if ! XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user show-environment >/dev/null 2>&1; then
    warn "per-user systemd bus is unavailable — self-update and managed-app services will not work until user@$(id -u).service is running"
  fi

  sudo_do systemctl daemon-reload
  sudo_do systemctl enable "$SERVICE"
  # restart, NOT `enable --now`. `--now` only *starts*, and a start on a unit
  # that is already running is a no-op — so re-running this installer used to
  # fetch, rebuild and then leave the OLD process serving a .next that had been
  # replaced underneath it. Every chunk 404s and nosniff makes that fatal
  # (docs/TROUBLESHOOTING.md). `restart` starts an inactive unit just as well,
  # so this is also correct on a first install.
  sudo_do systemctl restart "$SERVICE"
  ok "$SERVICE enabled + restarted"

  info "waiting for http://$HEALTH_HOST:$PORT/api/health …"
  up=0
  for _ in $(seq 1 30); do
    body="$(curl -fsS --max-time 3 "http://$HEALTH_HOST:$PORT/api/health" 2>/dev/null || true)"
    if [ -n "$body" ]; then
      now_build="$(printf '%s' "$body" | sed -n 's/.*"buildId":"\([^"]*\)".*/\1/p')"
      now_instance="$(printf '%s' "$body" | sed -n 's/.*"runtimeInstanceId":"\([^"]*\)".*/\1/p')"
      # A healthy response is accepted only when it carries the nonce injected into
      # THIS service unit before restart. This remains correct when NEXT_DEPLOYMENT_ID
      # intentionally keeps buildId stable and cannot be satisfied by a stale or
      # unrelated process still listening on the same port.
      if [ "$now_instance" = "$RUNTIME_INSTANCE_ID" ]; then
        up=1; SERVICE_READY=1
        ok "health OK (build ${now_build:-unknown}, runtime instance verified)"
        break
      fi
    fi
    sleep 2
  done
  if [ "$up" -ne 1 ]; then
    # is-active needs no privileges — do not spend a sudo prompt on the sad path.
    if systemctl is-active --quiet "$SERVICE"; then
      warn "service is running but /api/health did not prove the restarted runtime instance — check: journalctl -u mso -e"
    else
      warn "$SERVICE is not running — check: journalctl -u mso -e"
    fi
  fi
elif [ "$DO_SERVICE" -eq 1 ]; then
  if is_wsl; then
    warn "WSL detected without systemd as PID 1 — service install skipped; the mso CLI is still installed"
    info "for the full service: enable systemd in /etc/wsl.conf, run 'wsl --shutdown' from Windows, reopen WSL, then re-run this installer --onboard"
  else
    warn "systemd is not available as PID 1 — service install skipped; run manually: PORT=$PORT bun run start"
  fi
fi

INSTALL_PHASE=runtime-restore
# `.next` and service state are stable. Release the exclusive mutation lock before
# local-start takes its shared side, then restore every previously-owned fallback
# using the exact env-file identity persisted with that runtime.
install_runtime_lifecycle_finish
trap - EXIT HUP INT TERM

INSTALL_PHASE=integrations
# ---- optional Claude Code integration ----
# MSO catalogs $DIR/claude-skills directly, so these symlinks are NOT required by MSO.
# They only expose the same official playbooks to Claude Code when its home exists.
SKILL_DIR="${MSO_SKILL_DIR:-$HOME/.claude/skills}"
if [ -d "$DIR/claude-skills" ] && [ -d "$(dirname "$SKILL_DIR")" ]; then
  mkdir -p "$SKILL_DIR"
  for s in "$DIR"/claude-skills/*/; do
    name="$(basename "$s")"
    if [ -e "$SKILL_DIR/$name" ] && [ ! -L "$SKILL_DIR/$name" ]; then
      warn "skill $name exists and is not a symlink — left alone"
      continue
    fi
    ln -sfn "${s%/}" "$SKILL_DIR/$name"
  done
  # Prune ours that no longer exist. Only symlinks POINTING INTO this repo's
  # claude-skills are touched, so a hand-made or third-party skill is never
  # removed. Without this a deleted skill kept a dangling entry forever and the
  # agent still saw it listed (mso-browser-list did exactly that).
  for l in "$SKILL_DIR"/*; do
    [ -L "$l" ] || continue
    tgt="$(readlink "$l")"
    case "$tgt" in "$DIR/claude-skills/"*) [ -d "$tgt" ] || { rm -f "$l"; info "pruned stale skill $(basename "$l")"; } ;; esac
  done
  ok "skills → $SKILL_DIR (/mso, /mso-camoufox, /mso-apps, /mso-list, …)"
fi

INSTALL_PHASE=summary
# ---- next steps ----
# How to reach it depends on the bind AND on the Secure session cookie: a
# browser only keeps that cookie over plain http on localhost/127.0.0.1/::1, so
# any address that is not one of those needs TLS or a tunnel to log in at all.
WHOAMI="$(id -un)"
case "$BIND" in
  127.0.0.1|::1|localhost)
    REACH="tunnel from your own machine:
              ssh -N -L $PORT:127.0.0.1:$PORT $WHOAMI@<this-host>
            then open  http://localhost:$PORT
            (or \`tailscale serve $PORT\`, or a TLS reverse proxy → 127.0.0.1:$PORT)" ;;
  0.0.0.0|::)
    REACH="http://<this-host>:$PORT
            !! bound on EVERY interface. An authenticated session runs commands as
               $WHOAMI — firewall it, or re-run with --bind 127.0.0.1.
               Plain http to an IP also cannot log in: the session cookie is Secure." ;;
  *)
    REACH="http://$BIND:$PORT
            (plain http to a non-loopback address cannot complete a login — the
             session cookie is Secure. Put TLS in front, or tunnel to loopback.)" ;;
esac

if [ "$SERVICE_READY" -eq 1 ]; then
  OPEN_STATUS="$REACH"
  LOG_STATUS="journalctl -u mso -f"
elif [ "$DO_SERVICE" -eq 0 ]; then
  OPEN_STATUS="not running (--no-service). Start manually: cd $DIR && PORT=$PORT bun run start"
  LOG_STATUS="no system service installed"
elif [ "$SERVICE_ATTEMPTED" -eq 1 ]; then
  OPEN_STATUS="service was installed/restarted but did not pass health verification; inspect the journal before opening the UI"
  LOG_STATUS="journalctl -u mso -e"
elif is_wsl; then
  OPEN_STATUS="not running (WSL systemd is unavailable). Enable systemd or start manually from $DIR"
  LOG_STATUS="no system service installed"
else
  OPEN_STATUS="systemd is unavailable; start manually from $DIR"
  LOG_STATUS="no system service installed"
fi

ok "mso installed at $DIR"
cat <<EOF

  Runtime:  $OPEN_STATUS
  Env:      $DIR/.env.local
EOF
[ -n "$GEN_PW" ] && printf '  Password: %s   (shown once — save it now; edit OS_LOGIN_PASSWORD in .env.local + service refresh to change)\n' "$GEN_PW"
cat <<EOF

  Pair your first device after the API is running (device approval is a browser allowlist, not standards-based 2FA):
    1. Open the URL, enter the password — the browser lands PENDING and shows a device id.
    2. On this server:
         node $DIR/scripts/approve-device.js --list                 # see the pending id
         node $DIR/scripts/approve-device.js <deviceId> "my phone"  # approve it
    3. Reload + log in. Approve later devices from Settings → Devices.

  Logs:     $LOG_STATUS
  Update:   re-run this installer (pull + verify + build + service refresh), or --uninstall to remove
  Listen:   $BIND:$PORT   (change with --bind / MSO_BIND)
  Security: verify from OUTSIDE the box — \`curl -m5 http://<public-ip>:$PORT/api/health\`
            run on your laptop is the only test that proves what is reachable.
            Review ~/.mso/audit.log.
EOF

INSTALL_PHASE=onboarding
# A successful fresh install should lead directly into a usable product. curl|bash
# owns stdin, so interactive setup uses the controlling terminal explicitly.
RUN_ONBOARD=0
case "$ONBOARD_MODE" in
  always) RUN_ONBOARD=1 ;;
  never) RUN_ONBOARD=0 ;;
  auto) [ "$FRESH_INSTALL" -eq 1 ] && RUN_ONBOARD=1 ;;
esac
if [ "$RUN_ONBOARD" -eq 1 ] && [ "$SERVICE_READY" -eq 1 ]; then
  if [ "$YES" -eq 1 ]; then
    echo
    info "running minimal non-interactive onboarding (-y)…"
    "$BIN_DIR/mso" onboard -y || warn "onboarding did not finish — rerun: mso onboard"
  elif [ -r /dev/tty ] && [ -w /dev/tty ]; then
    echo
    info "starting guided onboarding…"
    if ! "$BIN_DIR/mso" onboard </dev/tty >/dev/tty 2>/dev/tty; then
      warn "onboarding stopped early — resume anytime with: mso onboard"
    fi
  else
    echo
    warn "no interactive terminal detected — onboarding skipped. Run: mso onboard"
  fi
elif [ "$RUN_ONBOARD" -eq 1 ]; then
  warn "no verified running MSO API is available for onboarding — start/enable the service, then run 'mso onboard'"
fi

INSTALL_PHASE=complete
# MSO_INSTALLER_CORE_EOF
