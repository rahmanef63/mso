import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("organization CLI contract", () => {
  it("routes org through the canonical organization API with revision checks", async () => {
    const state = await readFile("scripts/cli/commands-state.sh", "utf8"), org = await readFile("scripts/cli/organization.sh", "utf8"), commands = await readFile("scripts/cli/commands.sh", "utf8"), bin = await readFile("bin/mso", "utf8");
    expect(state).toContain('org)');
    expect(org).toContain('/api/v1/organization');
    expect(org).toContain('expected_revision');
    expect(commands).toContain('U_org=');
    expect(bin).toContain('org *');
  });
});
