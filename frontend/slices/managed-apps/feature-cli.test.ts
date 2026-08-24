import { describe, expect, it } from "vitest";
import { cliCommand, dashboardFeature } from "./feature-cli";

describe("managed app CLI launch commands", () => {
  it("never starts a second 9Router server", () => {
    expect(cliCommand(dashboardFeature("9router", "9Router"))).toBe("docker logs --tail 80 9router");
  });

  it("keeps the upstream read-only status command for CLI-managed apps", () => {
    expect(cliCommand(dashboardFeature("hermes", "Hermes"))).toBe("hermes status");
    expect(cliCommand(dashboardFeature("openclaw", "OpenClaw"))).toBe("openclaw status");
  });
});
