import { describe, expect, it } from "vitest";
import { getManagedAppDefinition, isManagedAppId, listManagedAppDefinitions } from "./catalog";
import { MANAGED_APP_ACTIONS } from "./types";

describe("managed app catalog", () => {
  it("uses one shared catalog for exactly Hermes, OpenClaw and 9Router", () => {
    const definitions = listManagedAppDefinitions();
    expect(definitions.map((item) => item.id)).toEqual(["hermes", "openclaw", "9router"]);
    expect(new Set(definitions.map((item) => item.id)).size).toBe(3);
  });

  it("rejects arbitrary application ids and commands", () => {
    expect(isManagedAppId("hermes")).toBe(true);
    expect(isManagedAppId("openclaw")).toBe(true);
    expect(isManagedAppId("9router")).toBe(true);
    expect(isManagedAppId("hermes;rm -rf /")).toBe(false);
    expect(MANAGED_APP_ACTIONS).toEqual(["start", "stop", "restart", "backup"]);
  });

  it("keeps runtime-specific configuration separate", () => {
    const definitions = listManagedAppDefinitions();
    expect(new Set(definitions.map((item) => item.command)).size).toBe(definitions.length);
    expect(new Set(definitions.map((item) => item.stateDirName)).size).toBe(definitions.length);
    const hermes = getManagedAppDefinition("hermes");
    const openclaw = getManagedAppDefinition("openclaw");
    expect(hermes.serviceNames).not.toEqual(openclaw.serviceNames);
  });
});
