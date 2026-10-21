// Raw comparison between the checkout and the resolved update target. No
// `server-only`, no Next alias: lib/host/self-update.ts (inside Next) and
// scripts/self-update-auto.ts (the nightly timer, outside Next) collect the SAME
// facts through this module, so an unattended run cannot decide on different
// numbers than the panel it is configured from.
import type { UpdateCommit } from "./update-decision";
import { parseCommits } from "./update-decision";
import { resolveUpdateTarget, stableRelationAhead, type TargetGitRunner } from "./self-update-channel";

export interface UpdateFacts {
  insideWorkTree: boolean;
  branch: string;
  head: string;
  subject: string;
  dirty: boolean;
  remoteChecked: boolean;
  ahead: number;
  behind: number;
  commits: UpdateCommit[];
  latest: string;
  /** Full sha of the resolved target; what an unattended run pins before building. */
  targetSha: string;
  /** Paths in `HEAD..target`, only read when `behind > 0` (see `autoUpdateGate`). */
  changedPaths: string[];
  targetRef: string;
  targetLabel: string;
  targetFallback: boolean;
}

export interface CollectOptions {
  git: TargetGitRunner;
  channel: "stable" | "main";
  /** A network round trip; the panel polls without it while a build runs. */
  fetch: boolean;
  /** `git fetch --quiet origin main …`; overridable so the timer can skip it. */
  fetchRemote?: () => Promise<{ code: number }>;
}

const EMPTY: UpdateFacts = {
  insideWorkTree: false, branch: "", head: "", subject: "", dirty: false,
  remoteChecked: false, ahead: 0, behind: 0, commits: [], latest: "",
  targetSha: "", changedPaths: [], targetRef: "origin/main", targetLabel: "origin/main", targetFallback: false,
};

export async function collectUpdateFacts(opts: CollectOptions): Promise<UpdateFacts> {
  const { git } = opts;
  const inside = await git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") return { ...EMPTY };

  const [branch, head, subject, status] = await Promise.all([
    git(["branch", "--show-current"]),
    git(["rev-parse", "--short", "HEAD"]),
    git(["log", "-1", "--format=%s"]),
    git(["status", "--porcelain"]),
  ]);

  let remoteChecked = false;
  if (opts.fetch && opts.fetchRemote) {
    const fetched = await opts.fetchRemote();
    remoteChecked = fetched.code === 0;
  }

  const target = await resolveUpdateTarget(opts.channel, git);
  const relation = await git(["rev-list", "--left-right", "--count", `HEAD...${target.ref}`]);
  const [aheadRaw = "0", behindRaw = "0"] = relation.stdout.trim().split(/\s+/);
  const rawAhead = relation.code === 0 ? Number(aheadRaw) || 0 : 0;
  const behind = relation.code === 0 ? Number(behindRaw) || 0 : 0;
  // A stable checkout past its release tag is not "unpushed local work".
  const ahead = opts.channel === "stable" ? stableRelationAhead(rawAhead, behind) : rawAhead;

  const [commitLog, latest, sha, changed] = await Promise.all([
    git(["log", "--format=%h%x1f%s%x1f%cs", "-25", `HEAD..${target.ref}`]),
    git(["rev-parse", "--short", target.ref]),
    git(["rev-parse", "--verify", `${target.ref}^{commit}`]),
    behind > 0 ? git(["diff", "--name-only", `HEAD..${target.ref}`]) : Promise.resolve({ code: 0, stdout: "", stderr: "" }),
  ]);
  return {
    insideWorkTree: true,
    branch: branch.stdout,
    head: head.stdout.trim() || "unknown",
    subject: subject.stdout.trim(),
    dirty: status.stdout.trim().length > 0,
    remoteChecked,
    ahead,
    behind,
    commits: commitLog.code === 0 ? parseCommits(commitLog.stdout) : [],
    latest: latest.code === 0 ? latest.stdout.trim() : "",
    targetSha: sha.code === 0 ? sha.stdout.trim() : "",
    changedPaths: changed.code === 0 ? changed.stdout.split("\n").map((p) => p.trim()).filter(Boolean) : [],
    targetRef: target.ref,
    targetLabel: target.label,
    targetFallback: target.fallback,
  };
}
