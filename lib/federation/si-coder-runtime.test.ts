import { describe, expect, it } from "vitest";
import { inspectSiCoderFederationRuntime, siCoderFederationScope } from "./si-coder-runtime";

describe("SI-Coder federation runtime", () => {
  it("classifies current machine functions conservatively", () => {
    expect(siCoderFederationScope("sc.version")).toBe("read");
    expect(siCoderFederationScope("sc.user.create")).toBe("write");
    expect(siCoderFederationScope("sc.doku.mcp.call")).toBe("exec");
    expect(siCoderFederationScope("sc.flow.run")).toBe("exec");
  });

  it("discovers the reviewed installed runtime instead of a shell-provided function list", async () => {
    const runtime = await inspectSiCoderFederationRuntime(process.cwd());
    expect(runtime.version).toMatch(/^0\./);
    expect(runtime.functionCount).toBeGreaterThanOrEqual(55);
    expect(runtime.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "sc.product.interview",
      "sc.user.connection.manage",
      "sc.doku.mcp.call",
      "sc.flow.run",
    ]));
  });
});
