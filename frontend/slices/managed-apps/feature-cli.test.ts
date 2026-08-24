import { describe, expect, it } from "vitest";
import { cliCommand, dashboardFeature, dashboardSurfaceSource } from "./feature-cli";

describe("managed app CLI launch commands", () => {
  it("never starts a second 9Router server", () => {
    expect(cliCommand(dashboardFeature("9router", "9Router"))).toBe("docker logs --tail 80 9router");
  });

  it("keeps the upstream read-only status command for CLI-managed apps", () => {
    expect(cliCommand(dashboardFeature("hermes", "Hermes"))).toBe("hermes status");
    expect(cliCommand(dashboardFeature("openclaw", "OpenClaw"))).toBe("openclaw status");
  });
});


describe("managed dashboard source precedence", () => {

  it("prefers an existing HTTPS application domain over a generated MSO host", () => {
    expect(dashboardSurfaceSource("https://9router.mso.example.com/", "https://9-router.example.com")).toEqual({
      source: "https://9-router.example.com",
      kind: "embedded",
    });
  });
  it("prefers the configured embedded domain over a public-IP fallback", () => {
    expect(dashboardSurfaceSource("https://9router.mso.example.com/", "http://203.0.113.10:20128")).toEqual({
      source: "https://9router.mso.example.com/",
      kind: "embedded",
    });
  });

  it("uses the public-IP URL only when no embedded domain exists", () => {
    expect(dashboardSurfaceSource(null, "http://203.0.113.10:20128")).toEqual({
      source: "http://203.0.113.10:20128",
      kind: "direct",
    });
  });
});
