import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ branch: "main", fetchFails: false, noGit: false, behind: 13, tags: "", targetSha: "7cffd11", dirty: false, ahead: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ promises: { readFile: vi.fn(async () => "") } }));
vi.mock("@/lib/prefs/store", () => ({ readPrefs: vi.fn(async () => ({})) }));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((command: string, args: string[], _options: unknown, done: (error: { code: number } | null, stdout: string, stderr: string) => void) => {
    let output = "", code = 0;
    const key = args.join(" ");
    if (command === "setsid" && args[0] === "--version") { output = "setsid from util-linux"; code = 0; }
    else if (command !== "git") code = 1; // This deployment has no systemd manager, but does have detached handoff.
    else if (key === "rev-parse --is-inside-work-tree") { output = "true"; code = fixture.noGit ? 1 : 0; }
    else if (key === "branch --show-current") output = fixture.branch;
    else if (key === "remote get-url origin") output = "https://github.com/rahmanef63/mso.git";
    else if (key === "rev-parse --short HEAD") output = "16860d9";
    else if (key === "rev-parse --short origin/main") output = "7cffd11";
    else if (key === "rev-parse --short v0.2.0") code = 1;
    else if (key === "rev-parse --verify origin/main^{commit}") output = fixture.targetSha;
    else if (key === "tag --merged origin/main --list v*") output = fixture.tags;
    else if (args[0] === "fetch") code = fixture.fetchFails ? 1 : 0;
    else if (args[0] === "rev-list") output = `${fixture.ahead}\t${fixture.behind}`;
    else if (key === "status --porcelain") output = fixture.dirty ? "M base.txt" : "";
    else if (args[0] === "merge-base") output = "abc1234def567890abc1234def567890abc12345";
    else if (key === "diff --name-only HEAD") output = fixture.dirty ? "base.txt" : "";
    else if (args[0] === "diff" && args.length === 4) output = args[3] === "HEAD" ? "" : "app/page.tsx";
    else if (args[0] === "ls-files") output = "";
    else if (args[0] === "merge-tree") { output = "2".repeat(40); code = 0; }
    else if (key === "log -1 --format=%s") output = "installed build";
    else if (args[0] === "log" && fixture.behind) output = "7cffd11\x1flatest update\x1f2026-09-12";
    done(code ? { code } : null, output, "");
  }),
}));

const { getUpdateStatus, blockingReason } = await import("./self-update");
beforeEach(() => {
  fixture.branch = "main"; fixture.fetchFails = false; fixture.noGit = false;
  fixture.behind = 13; fixture.tags = ""; fixture.targetSha = "7cffd11";
  fixture.dirty = false; fixture.ahead = 0;
});

describe("version discovery independent of restart mechanism", () => {
  it("offers the same update on a systemd-less host when detached handoff is available", async () => {
    const result = await getUpdateStatus(true, "main");
    expect(result).toMatchObject({ current: "16860d9", latest: "7cffd11", behind: 13, remoteChecked: true, supported: true, reason: null });
    expect(result.commits).toHaveLength(1);
    expect(blockingReason(result, false)).toBeNull();
  });
  it("still reports available versions on detached HEAD but refuses mutation", async () => {
    fixture.branch = "";
    const result = await getUpdateStatus(true, "main");
    expect(result).toMatchObject({ behind: 13, remoteChecked: true, supported: false });
    expect(result.reason).toContain("detached HEAD");
  });
  it("does not claim a failed fetch was verified", async () => {
    fixture.fetchFails = true;
    fixture.behind = 0;
    expect(await getUpdateStatus(true, "main")).toMatchObject({ behind: 0, remoteChecked: false, supported: true });
  });
  it("does not claim a cached-only poll checked the remote", async () => {
    expect(await getUpdateStatus(false, "main")).toMatchObject({ behind: 13, remoteChecked: false });
  });
  it("keeps an archive deployment explicitly unknown", async () => {
    fixture.noGit = true;
    expect(await getUpdateStatus(true, "main")).toMatchObject({ current: "unknown", remoteChecked: false, supported: false });
  });
});

describe("conflict preflight in the status payload", () => {
  it("adds a read-only conflict report when the checkout is dirty", async () => {
    fixture.dirty = true;
    const result = await getUpdateStatus(false, "main");
    expect(result.dirty).toBe(true);
    expect(result.conflict).toMatchObject({ conflicted: [], carried: ["base.txt"], overlap: [], safe: true });
  });

  it("also preflights a diverged main, not just a dirty tree", async () => {
    fixture.ahead = 2;
    const result = await getUpdateStatus(false, "main");
    expect(result).toMatchObject({ ahead: 2, behind: 13 });
    expect(result.conflict).toMatchObject({ safe: true });
  });

  it("omits the report entirely on a clean, non-diverged checkout", async () => {
    const result = await getUpdateStatus(false, "main");
    expect(result.conflict).toBeUndefined();
  });

  it("refusal stays a string, and the structured report rides alongside it", async () => {
    fixture.dirty = true;
    const result = await getUpdateStatus(false, "main");
    const refusal = blockingReason(result, false);
    expect(typeof refusal).toBe("string");
    expect(refusal).toContain("uncommitted changes");
    expect(refusal).toContain("carry over cleanly");
    expect(result.conflict?.safe).toBe(true);
  });
});

describe("stable channel", () => {
  it("compares against the newest release tag, not origin/main", async () => {
    fixture.tags = "v0.2.0\nv0.9.0";
    const result = await getUpdateStatus(true, "stable");
    expect(result).toMatchObject({ channel: "stable", target: "v0.9.0", targetFallback: false });
    // The fixture reports 13 commits for any rev-list target; what matters is that
    // the tag was chosen and reported so the operator can see the comparison.
    expect(result.behind).toBe(13);
  });

  it("says out loud that stable is following main when no tag exists", async () => {
    fixture.tags = "";
    const result = await getUpdateStatus(true, "stable");
    expect(result).toMatchObject({ channel: "stable", targetFallback: true });
    expect(result.target).toContain("no release tag exists yet");
  });
});
