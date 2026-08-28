import { describe, expect, it } from "vitest";
import { isDeviceRole, roleAtLeast, storedDeviceRole } from "./roles";

describe("device roles", () => {
  it("orders viewer < operator < owner", () => {
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "operator")).toBe(false);
    expect(roleAtLeast("operator", "viewer")).toBe(true);
    expect(roleAtLeast("operator", "owner")).toBe(false);
    expect(roleAtLeast("owner", "operator")).toBe(true);
  });

  it("migrates missing legacy roles up, but malformed values down", () => {
    expect(storedDeviceRole(undefined)).toBe("owner");
    expect(storedDeviceRole("operator")).toBe("operator");
    expect(storedDeviceRole("admin")).toBe("viewer");
    expect(isDeviceRole("owner")).toBe(true);
    expect(isDeviceRole("root")).toBe(false);
  });
});
