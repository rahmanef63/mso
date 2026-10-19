import { describe, expect, it } from "vitest";
import { getManagedAppDefinition } from "./catalog";
import { managedAppInstallSupport } from "./host-compatibility";

describe("managed app install compatibility", () => {
  const host = (userSystemd: boolean, docker: boolean) =>
    ({ platform: "linux" as const, arch: "x64", glibc: true, userSystemd, docker });

  it("selects only reviewed backends supported by the current Linux host", () => {
    expect(managedAppInstallSupport(getManagedAppDefinition("hermes"), host(false, true)).backend).toBe("docker");
    expect(managedAppInstallSupport(getManagedAppDefinition("openclaw"), host(true, true)).backend).toBe("user-systemd");
    expect(managedAppInstallSupport(getManagedAppDefinition("9router"), host(true, true)).backend).toBe("docker");
    expect(managedAppInstallSupport(getManagedAppDefinition("orca"), host(true, true)).backend).toBe("user-systemd");
  });

  it("blocks app combinations without the required backend before installing", () => {
    for (const id of ["hermes", "openclaw", "9router", "orca"] as const) {
      const result = managedAppInstallSupport(getManagedAppDefinition(id), host(false, false));
      expect(result.supported).toBe(false);
      expect(result.reason).toMatch(/requires/);
    }
    expect(managedAppInstallSupport(getManagedAppDefinition("openclaw"), host(false, true)).supported).toBe(false);
    expect(managedAppInstallSupport(getManagedAppDefinition("9router"), host(true, false)).supported).toBe(false);
    expect(managedAppInstallSupport(getManagedAppDefinition("orca"), host(false, false)).supported).toBe(false);
  });

  it("requires a linux x64 glibc host for Orca's pinned release", () => {
    const orca = getManagedAppDefinition("orca");
    // Only x64 glibc has a reviewed build; a musl or non-x64 host must fail closed.
    expect(managedAppInstallSupport(orca, { platform: "linux", arch: "arm64", glibc: true, userSystemd: true, docker: false })).toMatchObject({
      supported: false, backend: null,
    });
    expect(managedAppInstallSupport(orca, { platform: "linux", arch: "x64", glibc: false, userSystemd: true, docker: false }).reason).toMatch(/x64 glibc/);
    expect(managedAppInstallSupport(orca, { platform: "linux", arch: "x64", glibc: true, userSystemd: true, docker: false }).supported).toBe(true);
  });

  it("requires a Linux runtime even when a daemon is reported by the host", () => {
    expect(managedAppInstallSupport(getManagedAppDefinition("hermes"), {
      platform: "darwin", userSystemd: true, docker: true,
    }).supported).toBe(false);
  });
});
