import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("single MSO release lifecycle authority", () => {
  it("routes ship, update and CLI deploy through mso-service-update", () => {
    const ship = read("scripts/ship-handoff.sh");
    const update = read("scripts/mso-update");
    const cli = read("scripts/cli/service.sh");
    expect(ship).toContain('SERVICE_UPDATE="$ROOT/scripts/mso-service-update"');
    expect(ship).toContain('/bin/bash "$SERVICE_UPDATE" --ship-finalize');
    expect(update).toContain('/bin/bash "$ROOT/scripts/mso-service-update"');
    expect(cli).toContain('MSO_SERVICE_UPDATE_BIN:-$ROOT/scripts/mso-service-update');
    expect(cli).toContain('/bin/bash "$helper" --rebuild-only');
  });

  it("keeps build/restart inside the shared inner lifecycle and success outside it", () => {
    const outer = read("scripts/mso-service-update");
    const inner = read("scripts/self-update.sh");
    expect(outer).toContain('SELF_UPDATE="$ROOT/scripts/self-update.sh"');
    expect(outer).toContain('/bin/bash "$SELF_UPDATE" "$@"');
    expect(inner).toContain("verify-build.sh");
    expect(inner).toMatch(/restart/i);
    const restore = outer.indexOf("update_gateway_restore_all");
    const success = outer.lastIndexOf("UPDATE OK");
    expect(restore).toBeGreaterThan(0);
    expect(success).toBeGreaterThan(restore);
  });
});
