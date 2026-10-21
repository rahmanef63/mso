import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Single-origin by default; split-origin tests reset modules and stub the
// template explicitly, exactly like install.test.ts.
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
    id: "orca",
    name: "Orca",
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

const started = () => mockStart.mock.calls[0]![0];

beforeEach(() => {
  mockStart.mockReset();
  mockGet.mockReset();
  mockStart.mockResolvedValue({} as never);
  mockGet.mockResolvedValue(view(false));
  vi.mocked(dockerUsable).mockResolvedValue(true);
  vi.mocked(userBusUnavailable).mockReturnValue(false);
});

describe("Orca install uses the reviewed adapter, never a raw key", () => {
  it("refuses to install without a configured split origin", async () => {
    await expect(startInstall("orca")).rejects.toThrow(/split app origin/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("refuses a provider key, which Orca cannot store or use", async () => {
    await expect(startInstall("orca", { provider: "anthropic", apiKey: "sk-ant-x" })).rejects.toThrow(/does not accept a provider/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("refuses a non-loopback bind even though siblings allow it", async () => {
    await expect(startInstall("orca", { bind: "lan" })).rejects.toThrow(/loopback only/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("dispatches the repo script with the configured origin and no secret", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE", "{id}.mso.example.com");
    const fresh = await import("./install");
    await fresh.startInstall("orca");
    const { argv, env, kind, applicationId } = started();
    expect(kind).toBe("install");
    expect(applicationId).toBe("orca");
    expect(argv).toEqual([expect.stringMatching(/scripts\/managed-app-install$/), "orca"]);
    expect(env?.MSO_INSTALL_GATEWAY_BIND).toBe("loopback");
    expect(env?.MSO_INSTALL_APP_ORIGIN).toBe("https://orca.mso.example.com");
    expect(env).not.toHaveProperty("MSO_INSTALL_API_KEY");
    expect(env).not.toHaveProperty("MSO_INSTALL_PROVIDER");
    vi.unstubAllEnvs();
  });
});

describe("the install script routes Orca to the reviewed adapter", () => {
  const script = readFileSync(path.join(process.cwd(), "scripts", "managed-app-install"), "utf8");

  it("dispatches orca before the linger preflight that would change access", () => {
    // Orca's adapter performs its own user-bus check and must NOT ride the
    // Hermes/OpenClaw preflight, which calls `loginctl enable-linger` (an access
    // change) and would send Orca through a caller it does not need.
    const dispatch = script.indexOf('if [ "$APP" = "orca" ]');
    const linger = script.indexOf('loginctl enable-linger "');
    expect(dispatch).toBeGreaterThan(-1);
    expect(linger).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(linger);
    expect(script.slice(dispatch, linger)).toContain("managed-app-orca");
  });
});
