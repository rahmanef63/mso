#!/usr/bin/env bash
# Install/remove only this checkout's cron entries; do not start/install cron itself.
heartbeat_cron_quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
heartbeat_cron() {
  local action="$1" minutes="${OS_HEARTBEAT_INTERVAL_MINUTES:-30}" schedule marker old entry cron_path
  command -v crontab >/dev/null || gateway_fail 'crontab is unavailable; use the host supervisor to schedule heartbeat'
  case "$minutes" in 1|2|3|5|10|15|20|30) schedule="*/$minutes * * * *" ;; 60) schedule='0 * * * *' ;; *) gateway_fail 'interval must divide an hour (1,2,3,5,10,15,20,30,60)' ;; esac
  [[ "$ROOT$ENVF$PATH" != *$'\n'* ]] || gateway_fail 'cron paths must not contain newlines'
  marker="# mso-heartbeat:$KEY"
  old="$(crontab -l 2>/dev/null)" || {
    # Missing crontab is expected; other errors must not overwrite an existing table.
    local error
    error="$(crontab -l 2>&1 || true)"
    [[ "$error" == *'no crontab for'* ]] || gateway_fail 'could not read existing crontab'
    old=''
  }
  old="$(printf '%s\n' "$old" | grep -Fv -- "$marker" || true)"
  if [ "$action" = install-cron ]; then
    cron_path="$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin"
    # Cron's command shell is POSIX sh; Bash %q can emit unsupported $'...' syntax.
    printf -v entry 'env PATH=%s MSO_GATEWAY_ENV=%s /bin/bash %s once >/dev/null' "$(heartbeat_cron_quote "$cron_path")" "$(heartbeat_cron_quote "$ENVF")" "$(heartbeat_cron_quote "$ROOT/scripts/mso-heartbeat")"
    # Cron interprets percent even inside shell quotes. Escape it after shell quoting.
    entry="${entry//%/\\%}"
    { [ -z "$old" ] || printf '%s\n' "$old"; printf '%s %s %s\n' "$schedule" "$entry" "$marker"; printf '@reboot %s %s\n' "$entry" "$marker"; } | crontab -
    echo "heartbeat: installed cron every $minutes minutes and at cron startup"
  else
    { [ -z "$old" ] || printf '%s\n' "$old"; } | crontab -
    echo 'heartbeat: removed this checkout cron entries'
  fi
}
