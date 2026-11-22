import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "";
});

vi.mock("server-only", () => ({}));
vi.mock("./manager", () => ({ getManagedApp: vi.fn() }));
vi.mock("./jobs", () => ({ startManagedAppJob: vi.fn() }));
vi.mock("./docker", () => ({ dockerUsable: vi.fn() }));
vi.mock("./user-bus", () => ({ userBusUnavailable: vi.fn() }));
import { startManagedAppJob } from "./jobs";
import { getManagedApp } from "./manager";
import { dockerUsable } from "./docker";
import { userBusUnavailable } from "./user-bus";
import { startInstall } from "./install";
import { UNINSTALL_PREVIEW_FLAG, updateAdapter } from "./update-cli";
import type { ManagedAppView } from "./types";

const mockStart = vi.mocked(startManagedAppJob);
const mockGet = vi.mocked(getManagedApp);

const view = (installed: boolean): ManagedAppView =>
  ({
    id: "n8n",
    name: "n8n",
    description: "",
    installed,
    installationType: installed ? "docker" : "not-installed",
    state: installed ? "running" : "not-installed",
    healthy: null,
    version: null,
    dashboardAvailable: false,
    publicDashboardUrl: null,
    diagnostic: null,
    supportedActions: [],
  }) as ManagedAppView;

beforeEach(() => {
  mockStart.mockReset();
  mockGet.mockReset();
  mockStart.mockResolvedValue({} as never);
  mockGet.mockResolvedValue(view(false));
  vi.mocked(dockerUsable).mockResolvedValue(true);
  vi.mocked(userBusUnavailable).mockReturnValue(true);
});

describe("n8n install uses the reviewed Docker adapter on loopback", () => {
  it("refuses provider keys and non-loopback binds", async () => {
    await expect(startInstall("n8n", { provider: "openai", apiKey: "sk-x" })).rejects.toThrow(/does not accept a provider/);
    await expect(startInstall("n8n", { bind: "lan" })).rejects.toThrow(/loopback only/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("dispatches the repo install script for n8n even without a systemd user bus", async () => {
    await startInstall("n8n");
    const call = mockStart.mock.calls[0]![0];
    expect(call.kind).toBe("install");
    expect(call.applicationId).toBe("n8n");
    expect(call.argv).toEqual([expect.stringMatching(/scripts\/managed-app-install$/), "n8n"]);
    expect(call.env?.MSO_INSTALL_GATEWAY_BIND).toBe("loopback");
    expect(call.env).not.toHaveProperty("MSO_INSTALL_API_KEY");
  });

  it("dispatches n8n before the linger preflight in scripts/managed-app-install", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "managed-app-install"), "utf8");
    const dispatch = script.indexOf('if [ "$APP" = "n8n" ]');
    const linger = script.indexOf('loginctl enable-linger "');
    expect(dispatch).toBeGreaterThan(-1);
    expect(linger).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(linger);
    expect(script.slice(dispatch, linger)).toContain("managed-app-n8n");
  });

  it("builds update and uninstall argv cleanly and refuses unsupported options", () => {
    const adapterPath = "/home/operator/projects/mso/scripts/managed-app-n8n";
    expect(updateAdapter("n8n").updateArgv(adapterPath, {})).toEqual([adapterPath, "update", "--yes"]);
    expect(updateAdapter("n8n").uninstallArgv(adapterPath, false)).toEqual([adapterPath, "uninstall", "--yes"]);
    expect(updateAdapter("n8n").uninstallArgv(adapterPath, true)).toEqual([adapterPath, "uninstall", "--yes", UNINSTALL_PREVIEW_FLAG]);
    for (const options of [{ dryRun: true }, { channel: "beta" }, { tag: "latest" }, { branch: "main" }, { noRestart: true }]) {
      expect(() => updateAdapter("n8n").updateArgv(adapterPath, options)).toThrow("not supported for n8n");
    }
    expect(updateAdapter("n8n").pin).toBeNull();
  });
});
