import type { UpdateChannel } from "../prefs/updates";

// WHICH COMMIT A "SOFTWARE UPDATE" MEANS. The rolling branch is what this file
// always used; the stable channel is the newest release tag that is reachable from
// `origin/main`. Both are resolved HERE, on the server, from git output — the only
// thing a request (or a unit argument) may choose is the two-word enum.
//
// A tag becomes a git argv element, so it is filtered by this grammar first. A tag
// that does not match is not quoted, escaped or "cleaned": it is ignored.
const RELEASE_TAG = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/** The rolling branch. Unchanged from pre-Phase-4 behaviour. */
export const ROLLING_REF = "origin/main";

export interface UpdateTarget {
  channel: UpdateChannel;
  /** Resolved server-side: always `ROLLING_REF` or a RELEASE_TAG match. */
  ref: string;
  /** Human label for the panel. Never used as a command. */
  label: string;
  /** Stable found no release tag and is therefore tracking rolling main. Always
   *  reported to the operator — a silent fallback would be a lie about the channel. */
  fallback: boolean;
}

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

export type TargetGitRunner = (args: readonly string[]) => Promise<Ran>;

function parts(tag: string): [number, number, number] | null {
  const m = RELEASE_TAG.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Strict semver release tags, newest first. Unknown shapes are dropped. */
export function releaseTags(stdout: string): string[] {
  const seen = new Set(stdout.split("\n").map((line) => line.trim()).filter((tag) => RELEASE_TAG.test(tag)));
  return [...seen].sort((a, b) => {
    const pa = parts(a) ?? [0, 0, 0];
    const pb = parts(b) ?? [0, 0, 0];
    return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
  });
}

/** Pure decision: `git tag --merged origin/main --list 'v*'` output → target. */
export function chooseUpdateTarget(channel: UpdateChannel, tagOutput: string): UpdateTarget {
  if (channel === "main") return { channel, ref: ROLLING_REF, label: ROLLING_REF, fallback: false };
  const [tag] = releaseTags(tagOutput);
  if (!tag) {
    return { channel, ref: ROLLING_REF, label: `${ROLLING_REF} (no release tag exists yet)`, fallback: true };
  }
  return { channel, ref: tag, label: tag, fallback: false };
}

/**
 * Ask git for the release tag list, then confirm the chosen tag names a commit.
 *
 * Deliberately no `--sort=-v:refname`: git's version sort orders pre-releases and
 * build metadata differently from semver, and the ordering decision belongs in
 * `releaseTags`, which is covered by tests instead of by a git version.
 */
export async function resolveUpdateTarget(channel: UpdateChannel, git: TargetGitRunner): Promise<UpdateTarget> {
  if (channel === "main") return chooseUpdateTarget("main", "");
  const tags = await git(["tag", "--merged", ROLLING_REF, "--list", "v*"]);
  if (tags.code !== 0) {
    return { channel, ref: ROLLING_REF, label: `${ROLLING_REF} (release tag list unavailable)`, fallback: true };
  }
  const target = chooseUpdateTarget("stable", tags.stdout);
  if (target.fallback) return target;
  const commit = await git(["rev-parse", "--verify", `${target.ref}^{commit}`]);
  if (commit.code === 0) return target;
  return { channel, ref: ROLLING_REF, label: `${ROLLING_REF} (release tag ${target.ref} is unreadable)`, fallback: true };
}

/** `git fetch` arguments. Fixed strings only — no request input.
 *  `--tags` is unconditional: a release tag created on a commit we already have is
 *  NOT auto-followed by a plain `fetch origin main`, and the stable channel has to
 *  see it without a second round trip. */
export function fetchArgs(channel: UpdateChannel): string[] {
  void channel;
  return ["fetch", "--quiet", "--tags", "origin", "main"];
}

/**
 * Stable compares the checkout with a TAG, and a checkout that carries commits
 * after that tag is normal and healthy — it is not "local work that was not
 * pushed". So `ahead` is only meaningful when it also has incoming commits
 * (diverged); otherwise it is reported as 0 and a no-op update reads "up to date".
 */
export function stableRelationAhead(ahead: number, behind: number): number {
  return behind > 0 ? ahead : 0;
}
