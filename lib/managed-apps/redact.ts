// Managed-app output is UPSTREAM output — journald lines from their units and,
// now, whatever their own updater prints while it runs. Both can carry a
// credential (`openclaw update` talking to a registry, a Hermes traceback
// echoing a config value), and both end up in an HTTP response and on disk.
//
// One implementation, imported by the logs route and the job log, so the two can
// never drift into "the logs are scrubbed but the update transcript is not".
//
// The job TRANSCRIPT is by far the richer sink of the two — npm, pip, git and
// the two CLIs all print through it, and it is persisted AND served — so the
// three rules below were chosen against real update output rather than against
// journald alone:
//
//   1. `key = value` where the key is credential-shaped. Deliberately no longer
//      anchored with `\b` on the left: every measured survivor was a COMPOUND
//      name (`ANTHROPIC_API_KEY=`, `//registry.npmjs.org/:_authToken=`) where
//      `\b` could never match, or quoted JSON (`{"apiKey": "…"}`) where the
//      quote sat between the key and the colon. `openclaw update --dry-run
//      --json` prints JSON, so that shape is not hypothetical.
//   2. VALUE shapes that identify themselves — a bare `ghp_…` in a git error
//      has no key beside it at all.
//   3. credentials embedded in a URL (`https://user:pass@host/…`).
//
// What is deliberately NOT here: a generic "long random-looking string" rule.
// It would eat git SHAs, wheel filenames, image digests and integrity hashes,
// and the transcript is the operator's ONLY view of what an update did to their
// machine. Redaction that makes the log unreadable trades one failure for a
// worse one, so every rule below needs a credential NAME or a vendor PREFIX.

/** Credential-shaped key (optionally the tail of a compound name), then `:`/`=`
 *  with the quotes JSON puts around them, then the value up to its delimiter.
 *  The separator is preserved so redacted JSON still reads as JSON. */
const SECRET =
  /([\w.-]*(?:api[_-]?key|auth[_-]?token|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|token|secret|password|passwd|authorization|credential)s?)(["']?\s*[:=]\s*["']?)([^\s"',;)\]}]+)/gi;

/** Values that need no key next to them. Each is a vendor prefix plus enough
 *  length that ordinary words cannot reach it, and each is anchored with `\b`
 *  so it cannot start inside another token — without that, `sk-[…]{16,}` alone
 *  happily eats the tail of `disk-usage-report-2026-07-25-final`. Case
 *  SENSITIVE on purpose: these prefixes are lowercase upstream, and matching
 *  case-insensitively is how a filename becomes a false positive. */
const SECRET_VALUE = new RegExp(
  [
    "gh[pousr]_[A-Za-z0-9]{16,}", // GitHub PAT / OAuth / user / server / refresh
    "github_pat_[A-Za-z0-9_]{20,}",
    "sk-[A-Za-z0-9_-]{16,}", // OpenAI + Anthropic (sk-ant-, sk-proj-, sk-live-)
    "npm_[A-Za-z0-9]{20,}",
    "xox[abprs]-[A-Za-z0-9-]{10,}", // Slack
    "AKIA[0-9A-Z]{16}", // AWS access key id
    "eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}", // JWT
  ]
    .map((shape) => `\\b${shape}`)
    .join("|"),
  "g",
);

/** `scheme://user:secret@host` — a git remote or a registry URL printed back in
 *  an error. The user survives (it is often just `x-access-token`, and the log
 *  is useless without knowing which remote failed); the password does not. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi;

/** Redact one COMPLETE line and cap it at 8 KB. Callers must not hand this a
 *  partial line: a token split across two stream chunks would walk straight
 *  through the regex. */
export function redact(line: string): string {
  return line
    .replace(/\b(authorization["']?\s*[:=]\s*)("(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n;\]}]+)/gi, (match, prefix: string, value: string) => value === "[redacted" ? match : `${prefix}${value.startsWith('"') || value.startsWith("'") ? value[0] + "[redacted]" + value[0] : "[redacted]"}`)
    .replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(URL_CREDENTIALS, "$1$2:[redacted]@")
    .replace(SECRET, (match, key: string, separator: string, value: string) => value === "[redacted" ? match : `${key}${separator}[redacted]`)
    .replace(SECRET_VALUE, "[redacted]")
    .slice(0, 8192);
}
