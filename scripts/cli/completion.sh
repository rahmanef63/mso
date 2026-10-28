#!/usr/bin/env bash
# Shell completion: verbs from the dispatch table, subcommands from U_<verb> usage
# strings, so neither can go stale when a new arm is added.
# Sourced by scripts/cli/commands-admin.sh. Uses `verbs` and the U_ vars from
# scripts/cli/commands.sh, plus `die` from bin/mso.
# shellcheck disable=SC2154

# Segments of a usage string look like `threads list|show <id>|rm <id>`; the first
# token of each segment is the subcommand. Pipes inside <...> and [...] are part of
# an argument's own alternation, not subcommand separators, so they are masked first.
__mso_completion_subcommands() {
  local cv="$1" key u masked="" db=0 da=0 i len c parts part wlist w tok seen=" "
  key="${cv//-/_}"
  eval "u=\${U_${key}-}"
  [ -n "$u" ] || return 0
  u="${u#"${cv}"}"
  u="${u#" "}"
  if [[ "$u" =~ ^\[([a-zA-Z].*\|.*)\]$ ]]; then
    u="${BASH_REMATCH[1]}"
  fi
  len=${#u}
  for (( i=0; i<len; i++ )); do
    c="${u:i:1}"
    case "$c" in
      "[") ((db++)) ;;
      "]") ((db > 0)) && ((db--)) ;;
      "<") ((da++)) ;;
      ">") ((da > 0)) && ((da--)) ;;
      "|") ((db > 0 || da > 0)) && c=" " ;;
    esac
    masked+="$c"
  done
  # `--flag value|next` is a flag alternation, not two subcommands.
  while [[ "$masked" =~ (--[a-zA-Z0-9_-]+[[:space:]]+[a-zA-Z0-9_-]+)\|([a-zA-Z0-9_-]+) ]]; do
    masked="${masked//${BASH_REMATCH[0]}/${BASH_REMATCH[1]} ${BASH_REMATCH[2]}}"
  done
  IFS="|" read -ra parts <<< "$masked"
  subs=()
  for part in "${parts[@]}"; do
    part="${part#"${part%%[![:space:]]*}"}"
    if [[ "$part" =~ ^${cv}[[:space:]]+(.*)$ ]]; then
      part="${BASH_REMATCH[1]}"
      part="${part#"${part%%[![:space:]]*}"}"
    fi
    read -ra wlist <<< "$part"
    tok=""
    for w in "${wlist[@]}"; do
      w="${w//[\[\]()]/}"
      case "$w" in
        "") continue ;;
        -*|"$cv") break ;;
        \<*) continue ;;
        *) tok="$w"; break ;;
      esac
    done
    case "$tok" in
      "") continue ;;
      *)
        if [[ "$tok" =~ ^[a-zA-Z0-9_-]+$ ]] && [[ "$seen" != *" $tok "* ]]; then
          subs+=("$tok")
          seen="$seen$tok "
        fi ;;
    esac
  done
  echo "${subs[*]}"
}

mso_completion() {
  local vlist v subs
  vlist="$(verbs | grep -v '^-' | sort -u | tr '\n' ' ')"
  vlist="${vlist% }"

  case "${1:-bash}" in
    bash)
      printf '# bash completion for mso\n'
      printf '_mso() {\n'
      printf '  local cur="${COMP_WORDS[COMP_CWORD]}"\n'
      printf '  if [ "$COMP_CWORD" -eq 1 ]; then\n'
      printf '    COMPREPLY=( $(compgen -W "%s" -- "$cur") )\n' "$vlist"
      printf '    return 0\n'
      printf '  fi\n'
      printf '  if [ "$COMP_CWORD" -eq 2 ]; then\n'
      printf '    case "${COMP_WORDS[1]}" in\n'
      for v in $vlist; do
        subs=$(__mso_completion_subcommands "$v")
        if [ -n "$subs" ]; then
          printf '      %s) COMPREPLY=( $(compgen -W "%s" -- "$cur") ) ;;\n' "$v" "$subs"
        fi
      done
      printf '    esac\n'
      printf '    return 0\n'
      printf '  fi\n'
      printf '}\n'
      printf 'complete -F _mso mso\n' ;;
    zsh)
      printf '#compdef mso\n'
      printf '_mso() {\n'
      printf '  local -a verbs\n'
      printf '  verbs=(%s)\n\n' "$vlist"
      printf '  if (( CURRENT == 2 )); then\n'
      printf '    compadd -a verbs\n'
      printf '    return\n'
      printf '  fi\n\n'
      printf '  if (( CURRENT == 3 )); then\n'
      printf '    case "$words[2]" in\n'
      for v in $vlist; do
        subs=$(__mso_completion_subcommands "$v")
        if [ -n "$subs" ]; then
          printf '      %s) compadd %s ;;\n' "$v" "$subs"
        fi
      done
      printf '    esac\n'
      printf '    return\n'
      printf '  fi\n'
      printf '}\n'
      printf 'compdef _mso mso 2>/dev/null || true\n' ;;
    fish)
      printf 'complete -c mso -n '\''__fish_use_subcommand'\'' -a '\''%s'\''\n' "$vlist"
      for v in $vlist; do
        subs=$(__mso_completion_subcommands "$v")
        if [ -n "$subs" ]; then
          printf 'complete -c mso -n '\''__fish_seen_subcommand_from %s'\'' -a '\''%s'\''\n' "$v" "$subs"
        fi
      done ;;
    sh)
      printf '# Bare list of mso verbs for shells without native completion hooks\n'
      for v in $vlist; do
        printf '%s\n' "$v"
      done ;;
    *) die "completion: bash|zsh|fish|sh   (eval \"\$(mso completion bash)\")" ;;
  esac
}
