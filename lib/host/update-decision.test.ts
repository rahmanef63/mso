import { describe, expect, it } from "vitest";
import { autoUpdateGate, parseCommits, touchesUpdater, type AutoGateFacts } from "./update-decision";

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

describe("touchesUpdater", () => {
  it("matches allowlisted updater paths only, never a prefix or a similar name", () => {
    expect(touchesUpdater(["lib/host/self-update.ts"])).toBe("lib/host/self-update.ts");
    expect(touchesUpdater(["lib/host/self-update.tsx"])).toBeNull();
    expect(touchesUpdater(["docs/self-update.sh.md"])).toBeNull();
    expect(touchesUpdater([])).toBeNull();
  });
});
