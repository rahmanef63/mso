import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts/approve-device.js");

describe("approve-device cross-process lock protocol", () => {
  it("publishes the primary lock only while holding the shared recovery gate", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const acquire = source.slice(source.indexOf("function acquireLock()"), source.indexOf("function withMutation"));
    const gate = acquire.indexOf("openExclusive(RECOVERY");
    const primary = acquire.indexOf("openExclusive(LOCK");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(primary).toBeGreaterThan(gate);
    expect(acquire).toContain("return openExclusive(LOCK, token)");
    expect(source).not.toContain("function recoverAbandonedLock");
  });
});
