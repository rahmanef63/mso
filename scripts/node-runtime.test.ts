import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { NODE_RUNTIME_RANGE, supportedNodeRuntime } from "./check-node-runtime.mjs";

describe("one supported Node runtime contract", () => {
  it.each([
    ["20.9.0", false], ["20.19.0", false], ["22.11.0", false], ["22.12.0", true],
    ["22.23.2", true], ["23.0.0", false], ["24.0.0", true], ["25.0.0", false],
    ["26.0.0", true], ["28.1.0", true], ["invalid", false],
  ])("checks %s consistently in the package and early installer", (version, accepted) => {
    expect(supportedNodeRuntime(version)).toBe(accepted);
    const core = readFileSync("scripts/install-core.sh", "utf8");
    const predicate = /node -e '(const\[a,b\][^\n]+)'/.exec(core)?.[1];
    expect(predicate).toBeDefined();
    let code = -1;
    runInNewContext(predicate!, { process: { versions: { node: version }, exit: (value: number) => { code = value; } } });
    expect(code === 0).toBe(accepted);
  });
  it("gates advertised support, doctor and test tools on the same floor", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.engines.node).toBe(NODE_RUNTIME_RANGE);
    expect(readFileSync("scripts/cli/commands-host.sh", "utf8")).toContain("scripts/check-node-runtime.mjs");
    expect(readFileSync("scripts/check-test-toolchain.mjs", "utf8")).toContain("assertNodeRuntime()");
    for (const file of ["docs/INSTALL.md", "app/install/page.tsx", "docs/reference/WORKSPACE-GUIDE.md"])
      expect(readFileSync(file, "utf8")).not.toContain("20.9");
  });
});
