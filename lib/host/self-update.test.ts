// The two decisions in self-update that are not plumbing: what `git log` said, and
// whether the update may start at all. Both are pure, and both are the difference
// between "nothing happened, here is why" and a half-finished deploy — `next build`
// deletes the .next the live service is serving from, so a refusal has to happen
// BEFORE anything is touched.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseCommits, blockingReason, updateBranchReason, updateUnitArgs } = await import("./self-update");

const status = (over: Partial<Parameters<typeof blockingReason>[0]> = {}) => ({
  supported: true,
  reason: null,
  current: "abc1234",
  currentSubject: "feat: something",
  buildSha: "abc1234",
  pendingBuild: false,
  ahead: 0,
  behind: 3,
  commits: [],
  dirty: false,
  running: false,
  remoteChecked: true,
  log: "",
  ...over,
});

describe("parseCommits", () => {
  it("splits the unit-separated format git is asked for", () => {
    const out = ["9f3c9ee\x1ffix(deps): pin nanoid\x1f2026-08-17", "ecce676\x1fMerge pull request #3\x1f2026-08-16"].join("\n");
    expect(parseCommits(out)).toEqual([
      { sha: "9f3c9ee", subject: "fix(deps): pin nanoid", date: "2026-08-17" },
      { sha: "ecce676", subject: "Merge pull request #3", date: "2026-08-16" },
    ]);
  });

  it("survives a subject containing the characters a naive split would choke on", () => {
    // Real subjects in this repo carry colons, em dashes and parentheses. \x1f is
    // the separator precisely because none of them can appear in one.
    const [commit] = parseCommits("abc1234\x1ffix(ship): amend on retry — and collapse: a subject\x1f2026-08-14");
    expect(commit.subject).toBe("fix(ship): amend on retry — and collapse: a subject");
  });

  it("returns nothing for the up-to-date case rather than an empty-shaped row", () => {
    expect(parseCommits("")).toEqual([]);
    expect(parseCommits("\n  \n")).toEqual([]);
  });
});

describe("updateUnitArgs", () => {
  it("runs in the owner's user manager without sudo or a root User property", () => {
    const args = updateUnitArgs("/srv/mso", "/home/alice/.mso/self-update.log");

    expect(args.slice(0, 2)).toEqual(["--user", "--collect"]);
    expect(args).toContain("--unit=mso-self-update");
    expect(args).toContain("--property=WorkingDirectory=/srv/mso");
    expect(args).toContain("/srv/mso/scripts/mso-service-update");
    expect(args).not.toContain("--rebuild-only");
    expect(args.some((arg) => arg.startsWith("--property=User="))).toBe(false);
    expect(args.join(" ")).not.toContain("sudo");
  });

  it("exposes only the rebuild boolean as the optional operation", () => {
    const args = updateUnitArgs("/srv/mso", "/tmp/update.log", true);
    expect(args.at(-1)).toBe("--rebuild-only");
  });
});

describe("updateBranchReason", () => {
  it("keeps Settings updates on main", () => {
    expect(updateBranchReason("main\n")).toBeNull();
    expect(updateBranchReason("feat/runtime")).toContain("current: feat/runtime");
    expect(updateBranchReason("")).toContain("detached HEAD");
  });
});

describe("blockingReason", () => {
  it("lets a normal update through", () => {
    expect(blockingReason(status(), false)).toBeNull();
  });

  it("refuses normal updates when local main is ahead or diverged, but still permits an explicit rebuild", () => {
    expect(blockingReason(status({ ahead: 2, behind: 0 }), false)).toContain("ahead of origin/main");
    expect(blockingReason(status({ ahead: 2, behind: 114 }), false)).toContain("diverged");
    expect(blockingReason(status({ ahead: 2, behind: 114 }), true)).toBeNull();
  });

  it("refuses when there is nothing to pull, unless a rebuild was asked for", () => {
    expect(blockingReason(status({ behind: 0 }), false)).toBe("already up to date");
    expect(blockingReason(status({ behind: 0 }), true)).toBeNull();
  });

  it("is NOT 'up to date' when the running build is older than the checkout", () => {
    // Someone pulled without rebuilding: `git` says there is nothing to fetch while
    // the process is still serving the previous commit. Saying "already up to date"
    // there describes the checkout and leaves the operator with no way to act.
    const pending = status({ behind: 0, buildSha: "0000000", pendingBuild: true });
    expect(blockingReason(pending, false)).toBeNull();
    expect(blockingReason(pending, true)).toBeNull();
  });

  it("refuses a dirty checkout — the fast-forward would fail anyway", () => {
    expect(blockingReason(status({ dirty: true }), false)).toContain("uncommitted changes");
    // Also for a rebuild: the point of refusing is that we do not know what is in
    // the tree we are about to compile and serve.
    expect(blockingReason(status({ dirty: true }), true)).toContain("uncommitted changes");
  });

  it("refuses a second run while one is in flight", () => {
    expect(blockingReason(status({ running: true }), false)).toBe("an update is already running");
  });

  it("passes the unsupported reason through verbatim", () => {
    const reason = "this deployment is not a git checkout, so there is nothing to pull";
    expect(blockingReason(status({ supported: false, reason }), true)).toBe(reason);
  });
});
