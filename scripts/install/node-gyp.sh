#!/usr/bin/env bash
# Sourced after runtime quiescence. Only this build-tool cache uses npm; MSO uses Bun.
NODE_GYP_SOURCE="$DIR/scripts/install/node-gyp"
NODE_GYP_IDENTITY="$(node - "$NODE_GYP_SOURCE" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.argv[2];
const manifest = fs.readFileSync(path.join(root, 'package.json'));
const lock = fs.readFileSync(path.join(root, 'package-lock.json'));
const p = JSON.parse(manifest), l = JSON.parse(lock), version = p.dependencies?.['node-gyp'];
if (!/^\d+\.\d+\.\d+$/.test(version) || l.packages?.['']?.dependencies?.['node-gyp'] !== version ||
    l.packages?.['node_modules/node-gyp']?.version !== version) throw Error('Invalid locked node-gyp bootstrap');
console.log(version + ' ' + crypto.createHash('sha256').update(manifest).update(lock).digest('hex'));
NODE
)" || die "Could not validate the locked node-gyp bootstrap."
NODE_GYP_VERSION="${NODE_GYP_IDENTITY%% *}"
NODE_GYP_CACHE="${MSO_NODE_GYP_PREFIX:-$HOME/.cache/mso/node-gyp-$NODE_GYP_VERSION}"
# Never run npm ci in a user-provided prefix or the live checkout: it removes node_modules.
# A manifest-derived child also prevents silently reusing the earlier unlocked bootstrap.
NODE_GYP_PREFIX="$NODE_GYP_CACHE/${NODE_GYP_IDENTITY#* }"
NODE_GYP_BIN="$NODE_GYP_PREFIX/node_modules/.bin/node-gyp"

node_gyp_runner_matches() {
  [ ! -L "$1" ] &&
    cmp -s "$NODE_GYP_SOURCE/package.json" "$1/package.json" &&
    cmp -s "$NODE_GYP_SOURCE/package-lock.json" "$1/package-lock.json" &&
    [ -x "$1/node_modules/.bin/node-gyp" ] &&
    [ "$("$1/node_modules/.bin/node-gyp" --version 2>/dev/null || true)" = "v$NODE_GYP_VERSION" ]
}

ensure_node_gyp_runner() {
  if ! node_gyp_runner_matches "$NODE_GYP_PREFIX"; then
    [ ! -e "$NODE_GYP_PREFIX" ] && [ ! -L "$NODE_GYP_PREFIX" ] ||
      die "Invalid node-gyp cache at $NODE_GYP_PREFIX; preserve or remove that exact cache and retry."
    command -v npm >/dev/null 2>&1 || die "npm is required to provision locked node-gyp for node-pty."
    info "provisioning locked node-gyp v$NODE_GYP_VERSION for node-pty…"
    (
      # The subshell owns staging cleanup without replacing the installer's recovery trap.
      umask 077
      mkdir -p "$NODE_GYP_CACHE"
      stage="$(mktemp -d "$NODE_GYP_CACHE/.node-gyp-bootstrap.XXXXXX")"
      trap 'rm -rf -- "$stage"' EXIT
      cp "$NODE_GYP_SOURCE/package.json" "$NODE_GYP_SOURCE/package-lock.json" "$stage/"
      npm ci --prefix "$stage" --ignore-scripts --no-audit --no-fund >/dev/null
      node_gyp_runner_matches "$stage" || die "Unexpected node-gyp payload after locked bootstrap."
      # Publish atomically. A concurrent successful bootstrap may have won this cache key.
      node - "$stage" "$NODE_GYP_PREFIX" <<'NODE'
try { require('node:fs').renameSync(process.argv[2], process.argv[3]); }
catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
NODE
    )
    node_gyp_runner_matches "$NODE_GYP_PREFIX" || die "Locked node-gyp cache could not be verified."
  fi
  export PATH="${NODE_GYP_BIN%/*}:$PATH"
}
