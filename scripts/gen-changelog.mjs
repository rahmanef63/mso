#!/usr/bin/env node
// docs/CHANGELOG.md, DERIVED from git. Never hand-edited.
//
// CLAUDE.md's rule is "do not start a second log" — docs/CHANGELOG.md once existed
// as a hand-maintained twin of PROGRESS.md and was merged back in for exactly that
// reason. This does not reopen that: nothing is written here by hand, so there is
// no second thing to keep in sync and no way for it to disagree with history.
// PROGRESS.md stays the SSOT for WHY; this is a reverse-chronological WHAT, and it
// is what Settings → About renders as "What's new" so a change is visible in the
// running app instead of only in a terminal.
//
//   node scripts/gen-changelog.mjs           # write docs/CHANGELOG.md
//   node scripts/gen-changelog.mjs --check   # exit 1 if stale (used by the gates)
//
// Conventional-commit subjects are grouped by type; anything else lands under
// "Other" rather than being dropped, because a silently-omitted commit is how a
// changelog stops being trustworthy.
//
// NO COMMIT HASHES, deliberately. `ship` regenerates this AFTER committing and folds
// it in with --amend — which rewrites the SHA. If the file named hashes it would
// reference the pre-amend one, and the --check below would then disagree with itself
// on the very next run. Content that depends only on (date, type, scope, subject) is
// stable across the amend, so the check is meaningful.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "CHANGELOG.md");
const MAX_DAYS = 60; // keep it readable; git has the rest

const TYPES = [
  ["feat", "Added"],
  ["fix", "Fixed"],
  ["perf", "Faster"],
  ["refactor", "Changed"],
  ["test", "Tests"],
  ["docs", "Docs"],
  ["chore", "Chores"],
  ["build", "Build"],
  ["ci", "CI"],
];
const LABEL = new Map(TYPES);

// `%x00` separators: a commit subject may contain anything, including the
// characters a naive split would choke on.
const RAW = execSync(
  `git -C "${ROOT}" log --no-merges --date=short --pretty=format:"%h%x00%ad%x00%s"`,
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);

/** @type {Map<string, {hash:string,type:string,scope:string,subject:string}[]>} */
const byDay = new Map();
// A commit that only regenerates THIS file must not appear IN it. It is not a
// change anyone reads about, and listing it makes the file stale the instant it is
// committed: the generator reads subjects, so "docs(changelog): regenerate" is a
// subject the freshly-written file does not contain. `ship.sh` normally folds the
// regeneration into the commit it describes and never hits that, but when there is
// nothing to fold into (`ship` with an already-committed tree) it made its own
// commit — and the staleness gate then blocked every push, forever. Fixed here
// rather than in ship.sh so no caller can reintroduce the loop.
const SELF = /^docs\(changelog\)/i;

for (const line of RAW.split("\n").filter(Boolean)) {
  const [hash, date, subject] = line.split("\0");
  if (SELF.test(subject ?? "")) continue;
  const publicSubject = (subject ?? "").replace(/record that [A-Za-z0-9._-]+ now consumes this MCP surface/gi, "record external MCP consumer compatibility");
  const m = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(publicSubject);
  const type = m && LABEL.has(m[1]) ? m[1] : "other";
  if (!byDay.has(date)) byDay.set(date, []);
  byDay.get(date).push({ hash, type, scope: m?.[2] ?? "", subject: m?.[3] ?? publicSubject });
}

// Collapse identical (type, scope, subject) within a day. A retried ship, a
// squash-that-was-not, or a revert-and-reapply all leave the same subject in
// history twice — and this file having listed one change twice is what surfaced
// it. History keeps both commits; the reader does not need to see both.
for (const [date, list] of byDay) {
  const seen = new Set();
  byDay.set(
    date,
    list.filter((c) => {
      const key = `${c.type}\u0000${c.scope}\u0000${c.subject}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

const days = [...byDay.keys()].sort().reverse().slice(0, MAX_DAYS);
const out = [
  "# Changelog",
  "",
  "**Generated — do not edit.** `node scripts/gen-changelog.mjs`, run by `bun run ship`.",
  "Newest first. `docs/PROGRESS.md` is the source of truth for *why* a change was made;",
  "this is the *what*, and it is what Settings → About shows as “What's new”.",
  "",
];

for (const day of days) {
  out.push(`## ${day}`, "");
  const commits = byDay.get(day);
  for (const [type, label] of [...TYPES, ["other", "Other"]]) {
    const rows = commits.filter((c) => c.type === type);
    if (!rows.length) continue;
    out.push(`**${label}**`, "");
    for (const c of rows) {
      out.push(`- ${c.scope ? `\`${c.scope}\` ` : ""}${c.subject}`);
    }
    out.push("");
  }
}

const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

if (process.argv.includes("--check")) {
  const current = safeRead(OUT);
  if (current !== text) {
    console.error("docs/CHANGELOG.md is stale — run: node scripts/gen-changelog.mjs");
    process.exit(1);
  }
  console.log("changelog: current.");
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${days.length} days)`);
}

function safeRead(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
