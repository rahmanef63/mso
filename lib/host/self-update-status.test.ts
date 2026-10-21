import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ branch: "main", fetchFails: false, noGit: false, behind: 13, tags: "", targetSha: "7cffd11" }));
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
    else if (args[0] === "rev-list") output = `0\t${fixture.behind}`;
    else if (args[0] === "diff") output = "app/page.tsx";
    else if (key === "log -1 --format=%s") output = "installed build";
    else if (args[0] === "log" && fixture.behind) output = "7cffd11\x1flatest update\x1f2026-09-12";
    done(code ? { code } : null, output, "");
  }),
}));

const { getUpdateStatus, blockingReason } = await import("./self-update");
beforeEach(() => {
  fixture.branch = "main"; fixture.fetchFails = false; fixture.noGit = false;
  fixture.behind = 13; fixture.tags = ""; fixture.targetSha = "7cffd11";
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
