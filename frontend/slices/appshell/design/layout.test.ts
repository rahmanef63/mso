import { describe, expect, it } from "vitest";
import { layoutVariables, shellLayout } from "./layout";

describe("three-level presentation configuration", () => {
  it("inherits each shell profile and applies only its own overrides", () => {
    expect(shellLayout("ios")).toMatchObject({ "--ui-control-height": "2.75rem" });
    expect(shellLayout("android")).toMatchObject({ "--ui-control-height": "3rem" });
    const config = { windows: { pagePadding: 32, sidebarWidth: 288 } };
    expect(shellLayout("windows", config)).toMatchObject({ "--feature-padding": "2rem", "--feature-sidebar-width": "18rem" });
    expect(shellLayout("macos", config)).toEqual(shellLayout("macos"));
  });
  it("allows feature overrides without accepting invalid CSS dimensions", () => {
    expect(layoutVariables({ gap: 24, controlHeight: NaN, pagePadding: -3, sidebarWidth: Infinity })).toEqual({ "--feature-gap": "1.5rem" });
  });
});
