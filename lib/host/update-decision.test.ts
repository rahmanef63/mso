import { describe, expect, it } from "vitest";
import { autoUpdateGate, blockingReason, parseCommits, touchesUpdater, updateRefusal, type AutoGateFacts, type UpdateStatus } from "./update-decision";

const facts = (over: Partial<AutoGateFacts> = {}): AutoGateFacts => ({
  auto: true,
  supported: true,
  reason: null,
  dirty: false,
  running: false,
  ahead: 0,
  behind: 3,
  pendingBuild: false,
  consecutiveFailures: 0,
  changedPaths: ["app/page.tsx"],
  target: "v0.2.0",
  targetFallback: false,
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

  it("returns nothing for the up-to-date case rather than an empty-shaped row", () => {
    expect(parseCommits("")).toEqual([]);
    expect(parseCommits("\n  \n")).toEqual([]);
  });
});

describe("autoUpdateGate", () => {
  it("runs when every precondition holds", () => {
    expect(autoUpdateGate(facts())).toEqual({ run: true });
  });

  it("refuses when the owner never opted in, even if the timer fired", () => {
    // A timer that survived a `--auto off` must not keep updating the host.
    expect(autoUpdateGate(facts({ auto: false }))).toMatchObject({ run: false });
  });

  it("refuses an unsupported checkout, a dirty tree, a running update and local commits", () => {
    expect(autoUpdateGate(facts({ supported: false, reason: "checkout is on feat/x" }))).toEqual({
      run: false, reason: "checkout is on feat/x",
    });
    expect(autoUpdateGate(facts({ dirty: true })).run).toBe(false);
    expect(autoUpdateGate(facts({ running: true })).run).toBe(false);
    expect(autoUpdateGate(facts({ ahead: 2 })).run).toBe(false);
    expect(autoUpdateGate(facts({ ahead: 2, behind: 3 })).run).toBe(false);
  });

  it("pauses after two consecutive failed builds, and says which state it is in", () => {
    expect(autoUpdateGate(facts({ consecutiveFailures: 1 }))).toEqual({ run: true });
    const paused = autoUpdateGate(facts({ consecutiveFailures: 2 }));
    expect(paused.run).toBe(false);
    expect(paused.run === false && paused.reason).toContain("paused after 2 consecutive failed builds");
  });

  it("never auto-applies a commit that changes the updater", () => {
    for (const path of ["lib/host/self-update.ts", "scripts/mso-service-update", "scripts/self-update.sh"]) {
      const gate = autoUpdateGate(facts({ changedPaths: ["app/page.tsx", path] }));
      expect(gate.run, path).toBe(false);
      expect(gate.run === false && gate.reason).toContain(path);
      expect(gate.run === false && gate.reason).toContain("manually");
    }
  });

  it("does not apply the updater rule when there is nothing to pull", () => {
    // A pendingBuild-only run changes no commit, so no incoming diff is involved.
    expect(autoUpdateGate(facts({ behind: 0, pendingBuild: true, changedPaths: [] }))).toEqual({ run: true });
    expect(autoUpdateGate(facts({ behind: 0, changedPaths: ["scripts/self-update.sh"] }))).toMatchObject({ run: false });
  });

  it("calls a tag-lagging stable checkout current instead of falling back to main", () => {
    const gate = autoUpdateGate(facts({ behind: 0, target: "v0.2.0" }));
    expect(gate.run).toBe(false);
    expect(gate.run === false && gate.reason).toContain("already up to date with v0.2.0");
  });

  it("names the rolling fallback when no release tag exists yet", () => {
    const gate = autoUpdateGate(facts({ behind: 0, target: "origin/main (no release tag exists yet)", targetFallback: true }));
    expect(gate.run === false && gate.reason).toContain("no release tag exists yet");
  });
});

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  supported: true, reason: null, current: "abc1234", currentSubject: "feat: something",
  buildSha: "abc1234", pendingBuild: false, ahead: 0, behind: 3, commits: [], dirty: false,
  running: false, remoteChecked: true, log: "", target: "origin/main", ...over,
});

describe("updateRefusal", () => {
  it("keeps the reason string and stays backward compatible with blockingReason", () => {
    expect(blockingReason(status(), false)).toBeNull();
    expect(blockingReason(status({ dirty: true }), false)).toContain("uncommitted changes");
  });

  it("rides a structured conflict report alongside the unchanged dirty reason", () => {
    const conflict = {
      conflicted: [], carried: ["config/local.json"], overlap: [], safe: true, detail: "no merge conflicts",
    };
    const refusal = updateRefusal(status({ dirty: true, conflict }), false);
    expect(refusal.reason).toContain("uncommitted changes");
    expect(refusal.reason).toContain("carry over cleanly");
    expect(refusal.reason).toContain("config/local.json");
    expect(refusal.conflict).toBe(conflict);
  });

  it("names the conflicting files when the preflight says the update would collide", () => {
    const conflict = {
      conflicted: ["app/layout.tsx"], carried: ["app/layout.tsx"], overlap: ["app/layout.tsx"], safe: false, detail: "",
    };
    expect(updateRefusal(status({ dirty: true, conflict }), false).reason).toContain("app/layout.tsx");
  });

  it("carries the report on a diverged refusal and leaves clean states without one", () => {
    const conflict = {
      conflicted: ["lib/host/self-update.ts"], carried: [], overlap: [], safe: false, detail: "",
    };
    const diverged = updateRefusal(status({ ahead: 2, behind: 3, conflict }), false);
    expect(diverged.reason).toContain("diverged");
    expect(diverged.reason).toContain("lib/host/self-update.ts");
    expect(updateRefusal(status(), false)).toEqual({ reason: null, conflict: null });
  });
});

describe("touchesUpdater", () => {
  it("matches allowlisted updater paths only, never a prefix or a similar name", () => {
    expect(touchesUpdater(["lib/host/self-update.ts"])).toBe("lib/host/self-update.ts");
    expect(touchesUpdater(["lib/host/self-update.tsx"])).toBeNull();
    expect(touchesUpdater(["docs/self-update.sh.md"])).toBeNull();
    expect(touchesUpdater([])).toBeNull();
  });
});
