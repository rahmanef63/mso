import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ branch: "main", fetchFails: false, noGit: false, behind: 13 }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ promises: { readFile: vi.fn(async () => "") } }));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((command: string, args: string[], _options: unknown, done: (error: { code: number } | null, stdout: string, stderr: string) => void) => {
    let output = "", code = 0;
    const key = args.join(" ");
    if (command === "setsid" && args[0] === "--version") { output = "setsid from util-linux"; code = 0; }
    else if (command !== "git") code = 1; // This deployment has no systemd manager, but does have detached handoff.
    else if (key === "rev-parse --is-inside-work-tree") { output = "true"; code = fixture.noGit ? 1 : 0; }
    else if (key === "branch --show-current") output = fixture.branch;
    else if (key === "rev-parse --short HEAD") output = "16860d9";
    else if (key === "rev-parse --short origin/main") output = "7cffd11";
    else if (args[0] === "fetch") code = fixture.fetchFails ? 1 : 0;
    else if (args[0] === "rev-list") output = `0\t${fixture.behind}`;
    else if (key === "log -1 --format=%s") output = "installed build";
    else if (args[0] === "log" && fixture.behind) output = "7cffd11\x1flatest update\x1f2026-09-12";
    done(code ? { code } : null, output, "");
  }),
}));

const { getUpdateStatus, blockingReason } = await import("./self-update");
beforeEach(() => { fixture.branch = "main"; fixture.fetchFails = false; fixture.noGit = false; fixture.behind = 13; });

describe("version discovery independent of restart mechanism", () => {
  it("offers the same update on a systemd-less host when detached handoff is available", async () => {
    const result = await getUpdateStatus(true);
    expect(result).toMatchObject({ current: "16860d9", latest: "7cffd11", behind: 13, remoteChecked: true, supported: true, reason: null });
    expect(result.commits).toHaveLength(1);
    expect(blockingReason(result, false)).toBeNull();
  });
  it("still reports available versions on detached HEAD but refuses mutation", async () => {
    fixture.branch = "";
    const result = await getUpdateStatus(true);
    expect(result).toMatchObject({ behind: 13, remoteChecked: true, supported: false });
    expect(result.reason).toContain("detached HEAD");
  });
  it("does not claim a failed fetch was verified", async () => {
    fixture.fetchFails = true;
    fixture.behind = 0;
    expect(await getUpdateStatus(true)).toMatchObject({ behind: 0, remoteChecked: false, supported: true });
  });
  it("does not claim a cached-only poll checked the remote", async () => {
    expect(await getUpdateStatus(false)).toMatchObject({ behind: 13, remoteChecked: false });
  });
  it("keeps an archive deployment explicitly unknown", async () => {
    fixture.noGit = true;
    expect(await getUpdateStatus(true)).toMatchObject({ current: "unknown", remoteChecked: false, supported: false });
  });
});
