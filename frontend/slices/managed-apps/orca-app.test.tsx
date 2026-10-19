import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
});

import { MANAGED_APP_IDS } from "@/lib/managed-apps/types";
import { getManagedAppDefinition, isManagedAppId, listManagedAppDefinitions } from "@/lib/managed-apps/catalog";
import { BUILTIN_APPS } from "@/frontend/slices/os-shell/shell.manifest";
import { parseAppCatalog } from "@/lib/contracts/app-catalog";
import { appAllowedForRole } from "@/lib/auth/app-access";
import { managedAppHost, managedAppOrigin, managedAppIdForHost } from "@/lib/managed-apps/origin";
import { updateAdapter } from "@/lib/managed-apps/update-cli";
import { managedAppInstallSupport } from "@/lib/managed-apps/host-compatibility";
import { startInstall } from "@/lib/managed-apps/install";
import { orcaApp } from "./index";
import { OrcaApp } from "./app";

describe("Orca checkpoint 1 identity and presentation", () => {
  it("includes orca in typed MANAGED_APP_IDS and catalog SSOT", () => {
    expect(MANAGED_APP_IDS).toContain("orca");
    expect(isManagedAppId("orca")).toBe(true);
    const defs = listManagedAppDefinitions();
    const orcaDef = defs.find((d) => d.id === "orca");
    expect(orcaDef).toBeDefined();
    expect(orcaDef?.name).toBe("Orca");
    expect(orcaDef?.command).toBe("scripts/managed-app-orca");
    expect(orcaDef?.commandProvesInstall).toBe(false);
    expect(orcaDef?.serviceNames).toEqual(["mso-orca.service"]);
    expect(orcaDef?.containerNames).toEqual([]);
    expect(orcaDef?.dashboardUrl).toMatch(/6769/);
    expect(orcaDef?.healthPath).toBe("/web-index.html");
    expect(orcaDef?.stateDirName).toBe("orca");
    expect(orcaDef?.installBackends).toEqual([]);
    expect(getManagedAppDefinition("orca" as any)).toEqual(orcaDef);
  });

  it("registers Orca as a built-in shell application with /orca route", () => {
    expect(orcaApp).toBeDefined();
    expect(orcaApp.id).toBe("orca");
    expect(orcaApp.title).toBe("Orca");
    const shellEntry = BUILTIN_APPS.find((app) => app.id === "orca");
    expect(shellEntry).toBeDefined();
    expect(shellEntry?.slug).toBe("orca");
    expect(shellEntry?.title).toBe("Orca");
  });

  it("accepts orca in app-catalog projection and rejects unknown apps", () => {
    const raw = JSON.stringify({
      schema: "urn:manef:app-catalog:v1",
      schemaVersion: 1,
      entries: [{ kind: "managed", id: "orca" }],
    });
    const parsed = parseAppCatalog(raw);
    expect(parsed.entries).toEqual([{ kind: "managed", id: "orca" }]);

    const unknownRaw = JSON.stringify({
      schema: "urn:manef:app-catalog:v1",
      schemaVersion: 1,
      entries: [{ kind: "managed", id: "not-an-app" }],
    });
    expect(() => parseAppCatalog(unknownRaw)).toThrow("unknown managed adapter");
  });

  it("enforces role isolation: Viewer denied, Operator and Owner allowed", () => {
    expect(appAllowedForRole("orca", "viewer")).toBe(false);
    expect(appAllowedForRole("orca", "operator")).toBe(true);
    expect(appAllowedForRole("orca", "owner")).toBe(true);
    expect(appAllowedForRole("orca", null)).toBe(false);
  });

  it("isolates Orca origin under split-origin configuration", () => {
    expect(managedAppHost("orca" as any)).toBe("orca.mso.example.com");
    expect(managedAppOrigin("orca" as any)).toBe("https://orca.mso.example.com");
    expect(managedAppIdForHost("orca.mso.example.com")).toBe("orca");
    expect(managedAppIdForHost("unknown.mso.example.com")).toBeNull();
  });

  it("fails unsupported install and update operations clearly without fake success", async () => {
    const def = getManagedAppDefinition("orca" as any);
    const installSupport = managedAppInstallSupport(def, { platform: "linux", userSystemd: true, docker: true });
    expect(installSupport.supported).toBe(false);
    expect(installSupport.reason).toMatch(/not available|unsupported/i);

    const adapter = updateAdapter("orca" as any);
    expect(adapter.capabilities.check).toBe(false);
    expect(adapter.capabilities.apply).toBe(false);
    expect(adapter.capabilities.uninstall).toBe(false);
    expect(adapter.capabilities.rollback).toBe(false);
    expect(() => adapter.updateArgv("orca-ide", {})).toThrow(/not supported for orca/);
    expect(() => adapter.uninstallArgv("orca-ide", false)).toThrow(/not supported for orca/);
    await expect(startInstall("orca")).rejects.toThrow("Orca installer is not available yet.");
  });

  it("exports OrcaApp component and renders initial loading presentation", () => {
    expect(typeof OrcaApp).toBe("function");
    const html = renderToStaticMarkup(<OrcaApp />);
    expect(html).toContain("Orca");
    expect(html).toContain("Detecting Orca");
    expect(html).toContain("Details");
  });
});
