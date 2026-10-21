import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasAvailableUpdate, REFUSAL_COMMANDS, updateRefusalRemedy } from "./update-status-client";

const dir = __dirname;
const section = readFileSync(join(dir, "update-section.tsx"), "utf8");
const card = readFileSync(join(dir, "update-status-unsupported.tsx"), "utf8");

describe("update refusal surface", () => {
  it("maps each actionable host refusal to its own remedy", () => {
    expect(updateRefusalRemedy("software updates require the checkout to be on main (current: feat/x)")).toBe("branch");
    expect(updateRefusalRemedy("the checkout has uncommitted changes — commit or stash them on the host first")).toBe("dirty");
  });

  it("does not invent a remedy it cannot deliver", () => {
    // No git checkout / no service unit: a shell command would be a lie.
    expect(updateRefusalRemedy("this deployment is not a git checkout, so there is nothing to pull")).toBeNull();
    expect(updateRefusalRemedy("mso.service has no automatic restart policy; refusing to stop the running process during self-update")).toBeNull();
    expect(updateRefusalRemedy(null)).toBeNull();
    expect(updateRefusalRemedy(undefined)).toBeNull();
  });

  it("keeps every remedy command read-only about the update itself", () => {
    for (const command of Object.values(REFUSAL_COMMANDS)) {
      // The update is the one fixed verb; the checkout is never rewritten in place.
      expect(command).toContain("mso update --rebuild");
      // No force, no hard reset, no untracked deletion.
      expect(command).not.toContain("--force");
      expect(command).not.toContain("reset --hard");
      expect(command).not.toContain("clean -");
    }
    // The branch remedy names the exact target branch; the dirty remedy must not
    // silently switch branches under uncommitted work.
    expect(REFUSAL_COMMANDS.branch).toContain("git checkout main");
    expect(REFUSAL_COMMANDS.dirty).not.toContain("git checkout");
    expect(REFUSAL_COMMANDS.dirty).toContain("git stash");
  });

  it("renders the reason instead of an empty panel when unsupported", () => {
    // The regression this guards: `supported:false` used to fall through to the
    // status card with zero action rows, which reads as a missing button.
    expect(section).toContain("info.supported === false");
    expect(section).toContain("UpdateStatusUnsupported");
    expect(card).toContain("Software updates are unavailable on this checkout");
    expect(card).toContain("REFUSAL_COMMANDS[remedy]");
  });

  it("still hides the update action while the host refuses", () => {
    expect(section).toContain('behind > 0 && ahead === 0 && (');
    expect(section).toContain('behind === 0 && (');
  });

  it("keeps the badge signal tied to real remote knowledge", () => {
    expect(hasAvailableUpdate({ behind: 0, pendingBuild: false, remoteChecked: false })).toBe(false);
    expect(hasAvailableUpdate({ behind: 3, pendingBuild: false, remoteChecked: false })).toBe(false);
    expect(hasAvailableUpdate({ behind: 3, pendingBuild: false, remoteChecked: true })).toBe(true);
    expect(hasAvailableUpdate({ behind: 0, pendingBuild: true, remoteChecked: false })).toBe(true);
  });
});
