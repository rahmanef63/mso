import { describe, expect, it } from "vitest";
import { getManagedAppDefinition } from "./catalog";
import { managedAppInstallSupport } from "./host-compatibility";

describe("managed app install compatibility", () => {
  const host = (userSystemd: boolean, docker: boolean) =>
    ({ platform: "linux" as const, userSystemd, docker });

  it("selects only reviewed backends supported by the current Linux host", () => {
    expect(managedAppInstallSupport(getManagedAppDefinition("hermes"), host(false, true)).backend).toBe("docker");
    expect(managedAppInstallSupport(getManagedAppDefinition("openclaw"), host(true, true)).backend).toBe("user-systemd");
    expect(managedAppInstallSupport(getManagedAppDefinition("9router"), host(true, true)).backend).toBe("docker");
  });

  it("blocks app combinations without the required backend before installing", () => {
    for (const id of ["hermes", "openclaw", "9router"] as const) {
      const result = managedAppInstallSupport(getManagedAppDefinition(id), host(false, false));
      expect(result.supported).toBe(false);
      expect(result.reason).toMatch(/requires/);
    }
    expect(managedAppInstallSupport(getManagedAppDefinition("openclaw"), host(false, true)).supported).toBe(false);
    expect(managedAppInstallSupport(getManagedAppDefinition("9router"), host(true, false)).supported).toBe(false);
  });

  it("requires a Linux runtime even when a daemon is reported by the host", () => {
    expect(managedAppInstallSupport(getManagedAppDefinition("hermes"), {
      platform: "darwin", userSystemd: true, docker: true,
    }).supported).toBe(false);
  });
});
