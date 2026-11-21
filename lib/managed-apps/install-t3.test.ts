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
import type { ManagedAppView } from "./types";

const mockStart = vi.mocked(startManagedAppJob);
const mockGet = vi.mocked(getManagedApp);

const view = (installed: boolean): ManagedAppView =>
  ({
    id: "t3",
    name: "T3 Code",
    description: "",
    installed,
    installationType: installed ? "systemd" : "not-installed",
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
  vi.mocked(userBusUnavailable).mockReturnValue(false);
});

describe("T3 Code install uses the reviewed adapter on loopback", () => {
  it("refuses a provider key and non-loopback binds", async () => {
    await expect(startInstall("t3", { provider: "anthropic", apiKey: "sk-ant-x" })).rejects.toThrow(/does not accept a provider/);
    await expect(startInstall("t3", { bind: "lan" })).rejects.toThrow(/loopback only/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("dispatches the repo install script for t3 with loopback bind", async () => {
    await startInstall("t3");
    const call = mockStart.mock.calls[0]![0];
    expect(call.kind).toBe("install");
    expect(call.applicationId).toBe("t3");
    expect(call.argv).toEqual([expect.stringMatching(/scripts\/managed-app-install$/), "t3"]);
    expect(call.env?.MSO_INSTALL_GATEWAY_BIND).toBe("loopback");
    expect(call.env).not.toHaveProperty("MSO_INSTALL_API_KEY");
  });

  it("dispatches t3 before the linger preflight in scripts/managed-app-install", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "managed-app-install"), "utf8");
    const dispatch = script.indexOf('if [ "$APP" = "t3" ]');
    const linger = script.indexOf('loginctl enable-linger "');
    expect(dispatch).toBeGreaterThan(-1);
    expect(linger).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(linger);
    expect(script.slice(dispatch, linger)).toContain("managed-app-t3");
  });
});
