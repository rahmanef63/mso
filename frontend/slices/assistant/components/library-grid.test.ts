import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOST_AI_TOOLS } from "../host-tools/registry";
import { OS_TOOLS } from "../lib/tools";

const source = fs.readFileSync(path.join(__dirname, "library-grid.tsx"), "utf8");

describe("agent library capability labels", () => {
  it("shows the real global catalog rather than inert per-agent skill metadata", () => {
    expect(OS_TOOLS).toHaveLength(HOST_AI_TOOLS.length);
    expect(source).toContain('isAgent ? OS_TOOLS.length');
    expect(source).toContain('"global tools"');
    expect(source).not.toContain("skills.flatMap");
  });
});
