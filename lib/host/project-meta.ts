// Host-owned runtime data is not a build asset; tracing exclusions preserve runtime guards.
// Bounded, side-effect-free metadata about ONE project directory. Split out of
// projects.ts so multi-root resolution and the projects_list enumeration can share
// exactly the same readers — two copies would be two chances to forget the symlink
// refusal below.
//
// Everything here refuses a symlink. A project's `package.json` or `.git/HEAD`
// pointing somewhere else is not a project fact, it is a redirect, and following
// one turns a bounded read into an arbitrary one.
import { promises as fs } from "fs";
import path from "path";
import { BOUNDED_READ, readBoundedRegularFile } from "./bounded-read";
import { runCommand } from "./exec";

export type PackageMeta = { name?: string; version?: string; scripts: string[] };
export type GitMeta = {
  available: boolean;
  branch?: string;
  clean?: boolean;
  changes?: string[];
  head?: { sha: string; subject?: string; date?: string };
  statusChecked: boolean;
  error?: string;
};

/** Every read here is capped BEFORE any bytes move — see bounded-read.ts. An
 *  oversized or symlinked artifact yields "" (no metadata), never a partial parse
 *  and never an unbounded allocation. */
export async function readRegularText(file: string, maxBytes = BOUNDED_READ.packageJson): Promise<string> {
  return (await readBoundedRegularFile(file, maxBytes)) ?? "";
}

export async function packageMeta(dir: string): Promise<PackageMeta> {
  try {
    const raw = await readRegularText(path.join(dir, "package.json"), BOUNDED_READ.packageJson);
    if (!raw) return { scripts: [] };
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown; scripts?: unknown };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      scripts: parsed.scripts && typeof parsed.scripts === "object" ? Object.keys(parsed.scripts) : [],
    };
  } catch {
    return { scripts: [] };
  }
}

/** Git context read straight off `.git`, with NO subprocess — safe to run across
 *  every project in an enumeration, where spawning one `git status` per row would
 *  not be. */
export async function boundedGitMeta(dir: string): Promise<GitMeta> {
  const gitDir = path.join(dir, ".git");
  const gitStat = await fs.lstat(gitDir).catch(() => null);
  if (!gitStat?.isDirectory() || gitStat.isSymbolicLink()) return { available: false, statusChecked: false };
  const head = await readRegularText(path.join(gitDir, "HEAD"), BOUNDED_READ.gitHead);
  if (!head) return { available: false, statusChecked: false };
  const candidateRef = head.trim().startsWith("ref: ") ? head.trim().slice(5) : undefined;
  const ref = candidateRef && /^refs\/(?:heads|remotes)\/[a-z0-9._\/-]+$/i.test(candidateRef) && !candidateRef.includes("..")
    ? candidateRef
    : undefined;
  const branch = ref?.replace(/^refs\/heads\//, "");
  let sha = ref ? (await readRegularText(path.join(/* turbopackIgnore: true */ gitDir, ref), BOUNDED_READ.gitRef)).trim() : head.trim();
  if (!sha && ref) {
    const packed = await readRegularText(path.join(gitDir, "packed-refs"), BOUNDED_READ.packedRefs);
    sha = packed.split("\n").find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? "";
  }
  return { available: true, branch, statusChecked: false, ...(sha ? { head: { sha } } : {}) };
}

/** The exec-scope variant: one subprocess, working tree status included. */
export async function fullGitMeta(dir: string): Promise<GitMeta> {
  const marker = "__MSO_HEAD__";
  const result = await runCommand(`git status --short --branch && printf '\n${marker}\n' && git log -1 --format='%H%n%s%n%aI'`, dir);
  if (result.code !== 0)
    return { available: false, statusChecked: true, error: (result.stderr || result.stdout).trim().slice(0, 220) };
  const [statusPart, headPart = ""] = result.stdout.split(`\n${marker}\n`);
  const statusLines = statusPart.split("\n").filter(Boolean);
  const changes = statusLines.slice(1, 81);
  const [sha = "", subject = "", date = ""] = headPart.trim().split("\n");
  return {
    available: true,
    branch: statusLines[0]?.replace(/^##\s*/, ""),
    clean: changes.length === 0,
    changes,
    statusChecked: true,
    head: { sha, subject, date },
  };
}
