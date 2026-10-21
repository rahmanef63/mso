import { describe, expect, it } from "vitest";
import { chooseUpdateTarget, fetchArgs, releaseTags, resolveUpdateTarget, stableRelationAhead } from "./self-update-channel";

describe("stable channel target resolution", () => {
  it("orders release tags by semver, not by git's output order", () => {
    // `git tag` sorts lexically by default, which puts v0.10.0 before v0.9.0.
    expect(releaseTags("v0.2.0\nv0.10.0\nv0.9.1\n")).toEqual(["v0.10.0", "v0.9.1", "v0.2.0"]);
  });

  it("drops every tag that is not a plain release number", () => {
    // A tag becomes an argv element downstream, so anything else is ignored here
    // rather than escaped later.
    expect(releaseTags("v1.2.3-rc.1\nnightly\nv1.2\nmain\nbackup/pre-update-1\nv0.2.0")).toEqual(["v0.2.0"]);
  });

  it("resolves stable to the newest tag, and rolling to origin/main", () => {
    expect(chooseUpdateTarget("stable", "v0.2.0\nv0.3.1")).toMatchObject({ ref: "v0.3.1", fallback: false });
    expect(chooseUpdateTarget("main", "v9.9.9")).toMatchObject({ ref: "origin/main", fallback: false });
  });

  it("is honest when tags lag behind the running build: no silent rolling fallback", () => {
    // v0.2.0 is an ancestor of main and package.json is far ahead; "stable" still
    // means the tag, so the panel compares against the tag and reports "current".
    const target = chooseUpdateTarget("stable", "v0.2.0");
    expect(target.ref).toBe("v0.2.0");
    expect(target.fallback).toBe(false);
  });

  it("falls back to rolling main ONLY when zero release tags exist, and says so", () => {
    const target = chooseUpdateTarget("stable", "nightly\n");
    expect(target).toMatchObject({ ref: "origin/main", fallback: true });
    expect(target.label).toContain("no release tag exists yet");
  });

  it("never lets a client-supplied string become the ref", async () => {
    const git = async (args: readonly string[]) => {
      if (args[0] === "tag") return { code: 0, stdout: "v1.0.0\n$(rm -rf /)\n../../etc/passwd", stderr: "" };
      return { code: 0, stdout: "abc", stderr: "" };
    };
    const target = await resolveUpdateTarget("stable", git);
    expect(target.ref).toBe("v1.0.0");
    expect(target.ref).not.toContain("passwd");
    // Only fixed argv ever reaches git.
    for (const call of [fetchArgs("stable"), fetchArgs("main")]) {
      for (const arg of call) expect(["fetch", "--quiet", "--tags", "origin", "main"]).toContain(arg);
    }
  });

  it("treats an unreadable tag list as a fallback instead of throwing", async () => {
    const target = await resolveUpdateTarget("stable", async () => ({ code: 1, stdout: "", stderr: "boom" }));
    expect(target.fallback).toBe(true);
    expect(target.ref).toBe("origin/main");
  });

  it("only reports local commits as 'ahead' when the release has something to apply", () => {
    // Past a release tag with no newer tag: this is the normal state, not unpushed work.
    expect(stableRelationAhead(7, 0)).toBe(0);
    expect(stableRelationAhead(7, 2)).toBe(7);
  });
});
