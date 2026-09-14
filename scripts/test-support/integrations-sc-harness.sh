#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)";trap 'find "$TMP" -type f -o -type l | xargs -r rm -f; find "$TMP" -depth -type d -empty -delete 2>/dev/null||true' EXIT
SRC="$TMP/worktrees/sc-flow-merge-main";mkdir -p "$SRC/bin"
printf '%s' '{"name":"si-coder-agent","version":"0.9.8","bin":{"sc":"bin/sc-entry.js"}}' >"$SRC/package.json"
chmod 600 "$SRC/package.json"
FAKE="$SRC/bin/sc-entry.js";LINK="$TMP/sc";LOG="$TMP/log";:>"$LOG"
cat >"$FAKE" <<'SC'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1-}" = version ];then printf '{"version":"0.9.8","source":"%s"}' "$FAKE_SC_SOURCE";exit;fi
if [ "${1-}" = data ]&&[ "${2-}" = export ];then
  out='';shift 2
  while [ $# -gt 0 ];do case "$1" in --out)out="$2";shift 2;;*)exit 9;;esac;done
  cat >"$out" <<'JSON'
{"format":"integration-bundle","version":1,"producer":{"name":"si-coder","version":"test"},"exportedAt":"2026-09-05T00:00:00Z","mode":"metadata","users":[{"id":"alice","label":"Alice","connections":[{"id":"work","label":"Work","provider":"github","source":"direct","authMethod":"classic-pat","scope":"account","fields":[{"key":"GITHUB_TOKEN","secret":true,"configured":true}]}]}]}
JSON
  chmod 600 "$out";printf '%s' '{"ok":true}';exit
fi
exit 8
SC
chmod +x "$FAKE";ln -s "$FAKE" "$LINK"
export MSO_SC_BIN="$LINK" FAKE_SC_SOURCE="$SRC"
die(){ printf '%s\n' "$*" >&2;exit 2; }
tty_ok(){ return 1; }
tty_line(){ REPLY=n; }
jpost(){ local route="$1" body="$2";printf '%s\t%s\n' "$route" "$body">>"$LOG";if jq -e '.apply==true' >/dev/null<<<"$body";then printf '%s' '{"producer":"si-coder","createUsers":[{"id":"alice","label":"Alice"}],"connections":[{"user":"alice","provider":"github","connection":"work","status":"create"}],"warnings":[],"canApply":true,"planId":"PLAN","created":1,"applied":true}';else printf '%s' '{"producer":"si-coder","createUsers":[{"id":"alice","label":"Alice"}],"connections":[{"user":"alice","provider":"github","connection":"work","status":"create"}],"warnings":[],"canApply":true,"planId":"PLAN"}';fi; }
source "$ROOT/scripts/mso-cli-integrations-sc.sh"
case "${1-}" in
 probe) integration_sc_probe;;
 spoof) printf '%s' '{"name":"si-coder-agent","version":"0.9.8","bin":{"sc":"bin/other.js"}}' >"$SRC/package.json";printf '%s' '// unrelated synthetic entrypoint' >"$SRC/bin/other.js";integration_sc_probe;;
 preview) integration_sc_preview;;
 *) exit 4;;
esac
