#!/usr/bin/env bash
# image-editor.sh — drive the mso image editor HEADLESS from the CLI. Hits
# POST/GET /api/v1/editor/exec (the same command registry the in-browser AI uses)
# against a React-free Doc reducer. There is NO headless renderer — `view` prints a
# URL you open in the real editor, and rendering happens there. The "session"
# (current Doc) lives in a temp JSON file; each verb sends it and saves the result.
#
#   image-editor.sh new [WxH]          fresh blank doc (default 1080x1080)
#   image-editor.sh open <img>         load an image file → 1:1 doc (image layer)
#   image-editor.sh run <cmd> [k=v...] run one command (e.g. adjust.set brightness=0.2)
#   image-editor.sh inspect            print the layer stack / canvas state
#   image-editor.sh tools              list every command + description
#   image-editor.sh doc                print the raw session Doc JSON
#   image-editor.sh save <path.json>   write the doc to a host file (CRUD persist)
#   image-editor.sh view <path.json>   URL to open in the REAL editor (renders there).
#                                      --shot is GONE: it drove the os-browser
#                                      sidecar, deleted 2026-08-10. Use /mso-camoufox.
#
# k=v values coerce: 12 / 1.5 → number, true/false → bool, else string.
# Session file: $OS_EDITOR_SESSION (default $TMPDIR/mso-image-editor.session.json).
set -euo pipefail

B="${OS_BASE:-http://127.0.0.1:4005}"
SCRIPT_REAL="$(readlink -f "$0")"
MSO_ROOT="${MSO_DIR:-$(cd "$(dirname "$SCRIPT_REAL")/../.." && pwd)}"
ENVF="${OS_ENV:-$MSO_ROOT/.env.local}"
# shellcheck disable=SC1090
set -a; . "$ENVF" 2>/dev/null || true; set +a
PASS="${OS_PASSWORD:-${OS_LOGIN_PASSWORD:-}}"
# Share the one CLI device `mso` created + you approved, so this script never
# needs its own approval round.
# No fallback constant: an id committed to a public repo, approved on request, is
# the second factor removed. `mso` writes the real one on first run.
DEV="${OS_DEVICE:-$(cat "$HOME/.mso/cli.device.id" 2>/dev/null)}"
[ -n "$DEV" ] || { echo "no CLI device id — run '$MSO_ROOT/bin/mso whoami' once to create ~/.mso/cli.device.id" >&2; exit 1; }
# proxy.ts blocks mutating /api without same-origin proof; Origin==Host is the
# documented non-browser path.
ORIGIN=(-H "origin: $B")
SESS="${OS_EDITOR_SESSION:-${TMPDIR:-/tmp}/mso-image-editor.session.json}"
[ -n "$PASS" ] || { echo "no OS_LOGIN_PASSWORD in $ENVF (set OS_PASSWORD)" >&2; exit 1; }

# Persistent cookie jar reused across invocations — log in only when the session
# is missing/expired (avoids the login rate-limiter on multi-command sequences).
JAR="${OS_EDITOR_JAR:-${TMPDIR:-/tmp}/mso-image-editor.jar}"
EXEC="$B/api/v1/editor/exec"

login() {
  local code
  # Jar created 0600 before curl touches it (curl -c would make it 0644 & ~umask) —
  # it holds a live session cookie at a fixed, guessable path. Body goes over stdin
  # so the cleartext password never lands in curl's argv.
  [ -f "$JAR" ] || { : > "$JAR"; chmod 600 "$JAR"; }
  code=$(jq -n --arg p "$PASS" --arg d "$DEV" '{password:$p,deviceId:$d,deviceLabel:"os-image-editor cli"}' \
    | curl -sS -o /dev/null -w '%{http_code}' -c "$JAR" "${ORIGIN[@]}" -X POST "$B/api/auth/login" \
    -H 'content-type: application/json' -d @- || true)
  [ "$code" = "200" ] || { printf 'login failed (%s). approve device? → node "%s" "%s"\n' "$code" "$MSO_ROOT/scripts/approve-device.js" "$DEV" >&2; exit 1; }
}
[ -f "$JAR" ] || login

# Run a request with the cached cookie; on 401 (expired) log in once + retry.
req() {
  local out code body
  out=$(curl -sS -b "$JAR" "${ORIGIN[@]}" -w $'\n%{http_code}' "$@" || true)
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    login; out=$(curl -sS -b "$JAR" "${ORIGIN[@]}" -w $'\n%{http_code}' "$@" || true)
    code="${out##*$'\n'}"; body="${out%$'\n'*}"
  fi
  [ "$code" = "200" ] || { echo "request failed ($code): $body" >&2; exit 1; }
  printf '%s' "$body"
}
post() { local p; p=$(cat); req -H 'content-type: application/json' -d "$p" "$EXEC"; }
have_session() { [ -f "$SESS" ] || { echo "no session — run 'open <img>' or 'new' first" >&2; exit 1; }; }
save_doc() { jq -e '.doc' >/dev/null <<<"$1" && jq '.doc' <<<"$1" >"$SESS"; }
show_results() { jq -r '.results[]? | "  \(.name) \(if .ok then "ok" else "ERR" end) — \(.result)"' <<<"$1"; }

# Build a JSON args object from k=v pairs, coercing numbers + booleans.
build_args() {
  local j='{}' kv k v
  for kv in "$@"; do
    k="${kv%%=*}"; v="${kv#*=}"
    if [[ "$v" =~ ^-?[0-9]+([.][0-9]+)?$ || "$v" == "true" || "$v" == "false" ]]; then
      j=$(jq -c --arg k "$k" --argjson v "$v" '. + {($k):$v}' <<<"$j")
    else
      j=$(jq -c --arg k "$k" --arg v "$v" '. + {($k):$v}' <<<"$j")
    fi
  done
  printf '%s' "$j"
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  new)
    resp=$(echo '{"commands":[]}' | post); save_doc "$resp"
    if [ -n "${1:-}" ] && [[ "$1" =~ ^([0-9]+)x([0-9]+)$ ]]; then
      a=$(build_args "width=${BASH_REMATCH[1]}" "height=${BASH_REMATCH[2]}")
      resp=$(jq -n --slurpfile d "$SESS" --argjson a "$a" '{doc:$d[0],commands:[{name:"doc.resize",args:$a}]}' | post)
      save_doc "$resp"
    fi
    echo "new session → $SESS"; jq -r '"  \(.width)x\(.height), \(.layers|length) layer(s)"' "$SESS" ;;
  open)
    f="${1:?image path}"; [ -f "$f" ] || { echo "no such file: $f" >&2; exit 1; }
    f=$(realpath "$f"); name=$(basename "$f")
    # Send the host PATH (not bytes) — the route probes dims from the file header
    # and stores a light same-origin path-URL src, so the doc carries no base64.
    resp=$(jq -n --arg p "$f" --arg n "$name" '{imagePath:$p,open:true,name:$n}' | post)
    save_doc "$resp"; echo "opened $f → $SESS"; jq -r '"  \(.width)x\(.height), \(.layers|length) layer(s)"' "$SESS" ;;
  run)
    have_session; name="${1:?command name}"; shift || true
    a=$(build_args "$@")
    resp=$(jq -n --slurpfile d "$SESS" --arg n "$name" --argjson a "$a" '{doc:$d[0],commands:[{name:$n,args:$a}]}' | post)
    save_doc "$resp"; show_results "$resp" ;;
  inspect)
    have_session
    resp=$(jq -n --slurpfile d "$SESS" '{doc:$d[0],commands:[{name:"doc.inspect"}]}' | post)
    jq -r '.results[0].result' <<<"$resp" ;;
  tools)
    req "$EXEC" | jq -r '.tools[] | "  \(.name)\t\(.description)"' ;;
  doc) have_session; cat "$SESS"; echo ;;
  save)
    have_session; out="${1:?dest path, e.g. ~/x.doc.json}"
    req -H 'content-type: application/json' \
      -d "$(jq -n --arg p "$out" --arg c "$(jq -c . "$SESS")" '{path:$p,content:$c}')" \
      "$B/api/v1/fs/write" >/dev/null
    echo "saved doc → $out   (render: $0 view $out)" ;;
  view)
    p="${1:?path}"; shift || true
    base="${OS_PUBLIC_BASE:-https://mso.rahmanef.com}"
    case "$p" in /*) ;; *) p="/$p" ;; esac
    url="$base/studio$p"; echo "$url"
    if [ "${1:-}" = "--shot" ]; then
      # The os-browser sidecar that backed this was deleted 2026-08-10 (its unit
      # had been stopped + disabled for months). Use /mso-camoufox, which drives a
      # real logged-in Firefox on the host.
      echo "--shot needs a logged-in browser: run /mso-camoufox, open the URL above, screenshot there." >&2
      exit 2
    else
      echo "# open that URL (logged-in browser) — Konva renders the doc"
    fi ;;
  *) sed -n '2,20p' "$0" ;;
esac
