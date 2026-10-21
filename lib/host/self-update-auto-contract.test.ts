import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { autoUpdateGate } from "./update-decision";

const root = path.join(__dirname, "..", "..");
const entry = readFileSync(path.join(root, "scripts/mso-auto-update"), "utf8");
const preflight = readFileSync(path.join(root, "scripts/self-update-auto.ts"), "utf8");
const inner = readFileSync(path.join(root, "scripts/self-update.sh"), "utf8");

describe("unattended update wiring", () => {
  it("keeps a refusal out of the unit's failure state", () => {
    // A `SKIP` is a correct decision. Exiting non-zero would make systemd record a
    // failed unit and, with Restart=, retry a host that must not be touched.
    expect(entry).toContain("SKIP\\ *) exit 0 ;;");
    expect(preflight).toContain("SKIP ${reason}");
  });

  it("never lets the timer pass a ref: only the channel enum reaches the updater", () => {
    expect(entry).toContain('stable|main) ;;');
    expect(entry).toContain('"--channel=$channel"');
    expect(entry).not.toMatch(/--channel=\$\(/);
  });

  it("pins the commit the pre-flight inspected", () => {
    expect(preflight).toContain("MSO_AUTO_TARGET_SHA=");
    expect(entry).toContain("export MSO_AUTO_TARGET_SHA");
    expect(inner).toContain("the $CHANNEL target moved after the pre-flight decision");
  });

  it("records a failure with the log's own reason, not a generic one", () => {
    expect(entry).toContain("--record failed");
    expect(preflight).toContain('line.includes("FAILED:")');
    expect(preflight).toContain('consecutiveFailures: result === "failed" ? state.consecutiveFailures + 1');
  });

  it("stops the run before the network when the owner never opted in", () => {
    const off = autoUpdateGate({
      auto: false, supported: true, reason: null, dirty: false, running: false, ahead: 0,
      behind: 4, pendingBuild: false, consecutiveFailures: 0, changedPaths: ["app/page.tsx"],
      target: "origin/main", targetFallback: false,
    });
    expect(off).toMatchObject({ run: false });
    // Compare inside the function body: the import line mentions the collector too.
    const body = preflight.slice(preflight.indexOf("async function decide"));
    expect(body.indexOf("if (!prefs.auto)")).toBeGreaterThan(0);
    expect(body.indexOf("if (!prefs.auto)")).toBeLessThan(body.indexOf("collectUpdateFacts"));
  });
});
