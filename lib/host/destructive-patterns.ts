// SERVER + CLIENT safe — pure regex, NO node imports. The catastrophic-command
// denylist, extracted from exec.ts so two callers share one source of truth:
//   • exec.ts (server) enforces it — refuses the command with code 126.
//   • the assistant's approval card (client) flags commands the server will refuse.
// exec.ts layers the explicit owner override on top; this is NOT a shell sandbox.

// High-confidence catastrophic patterns plus conservative recursive-delete
// expansion checks. Runtime shell values cannot be proven safe statically, so
// unresolved recursive-delete targets require an explicit reviewed literal path.
// Quoted prose or escaped/literal dollar signs may also be refused intentionally.
export const DESTRUCTIVE: { re: RegExp; why: string }[] = [
  { re: /\brm\b(?:\s+-\S*)*\s+-\S*[rf]\S*\s+(?:--no-preserve-root\s+)?\/(?:\s|$|\*)/, why: "rm -rf on /" },
  { re: /\brm\b(?=[^;&|\n]*\s(?:--recursive\b|-[A-Za-z]*[rR][A-Za-z]*(?:\s|$)))[^;&|\n]*(?:\$[A-Za-z_0-9@*#?$!{(]|`)/, why: "recursive rm with unresolved shell expansion — use an explicit reviewed path" },
  { re: /--no-preserve-root/, why: "rm --no-preserve-root" },
  { re: /\bmkfs(?:\.\w+)?\b/, why: "mkfs (format a filesystem)" },
  { re: /\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|vd|xvd|disk|hd)/, why: "dd to a block device" },
  { re: />\s*\/dev\/(?:sd|nvme|vd|xvd|hd)\w/, why: "redirect to a block device" },
  { re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, why: "fork bomb" },
  { re: /\b(?:chmod|chown)\b(?:\s+-\S*)*\s+-\S*R\S*\s+\S+\s+\/(?:\s|$)/, why: "recursive chmod/chown on /" },
  { re: /\bsystemctl\b[^\n;|&]*\b(?:stop|restart|disable|mask|isolate|kill)\b/, why: "systemctl stop/restart/disable — manage services over SSH" },
  { re: /\bservice\s+\S+\s+(?:stop|restart)\b/, why: "service stop/restart — manage services over SSH" },
  { re: /\b(?:shutdown|reboot|poweroff|halt)\b/, why: "shutdown/reboot/poweroff" },
  { re: /\binit\s+[06]\b/, why: "init 0/6" },
  { re: /\bkill\s+(?:-(?:9|KILL|SIGKILL)\s+)?1(?:\s|$)/, why: "kill PID 1" },
];

// Shell metacharacters that start a new command, open a subshell, or open/close a
// quoted string. Whole-string evaluation stays first so multi-segment patterns
// (fork bombs and recursive-delete expansion) are not lost through splitting.
const SEPARATORS = /[;&|()"'`\n]+/;

// A best-effort accident guard, not a parser for every shell spelling, interpreter,
// script body, alias, or dynamically assembled executable. Auth/scope/approval and
// the operating-system service user's authority remain the real trust boundary.
export function matchDestructive(cmd: string): string | null {
  for (const part of [cmd, ...cmd.split(SEPARATORS)]) {
    if (!part) continue;
    for (const d of DESTRUCTIVE) if (d.re.test(part)) return d.why;
  }
  return null;
}
