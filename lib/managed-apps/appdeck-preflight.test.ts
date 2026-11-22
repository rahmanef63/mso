import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./docker", () => ({ dockerUsable: vi.fn() }));
vi.mock("./user-bus", () => ({ userBusUnavailable: vi.fn() }));
vi.mock("./manager", () => ({ getManagedApp: vi.fn() }));
vi.mock("./origin", () => ({ managedAppOrigin: vi.fn() }));

import { dockerUsable } from "./docker";
import { getManagedApp } from "./manager";
import { managedAppOrigin } from "./origin";
import { runAppDeckPreflight } from "./appdeck-preflight";
import type { ManagedAppView } from "./types";
import { userBusUnavailable } from "./user-bus";

const baseView = (id: ManagedAppView["id"], installed = false): ManagedAppView => ({
  id,
  name: id,
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
});

beforeEach(() => {
  vi.mocked(dockerUsable).mockResolvedValue(true);
  vi.mocked(userBusUnavailable).mockReturnValue(false);
  vi.mocked(managedAppOrigin).mockReturnValue("https://orca.mso.example.com");
  vi.mocked(getManagedApp).mockImplementation(async (id) => baseView(id, false));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppDeck preflight readiness checks", () => {
  it("marks n8n ready when Docker is usable, lock exists, and port is free", async () => {
    vi.mocked(getManagedApp).mockResolvedValue(baseView("n8n", true));
    const report = await runAppDeckPreflight("n8n");
    expect(report.appId).toBe("n8n");
    expect(report.ready).toBe(true);
    expect(report.backend).toBe("docker");
    expect(report.checks.find((c) => c.id === "runtime")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "lock")?.status).toBe("pass");
  });

  it("reports an actionable failure when Docker is missing for n8n or 9router", async () => {
    vi.mocked(dockerUsable).mockResolvedValue(false);
    vi.mocked(getManagedApp).mockResolvedValue(baseView("9router", true));
    const report = await runAppDeckPreflight("9router");
    expect(report.ready).toBe(false);
    const runtime = report.checks.find((c) => c.id === "runtime");
    expect(runtime?.status).toBe("fail");
    expect(runtime?.fixHint).toMatch(/Docker/i);
  });

  it("reports missing split app origin clearly for Orca", async () => {
    vi.mocked(managedAppOrigin).mockReturnValue(null);
    vi.mocked(getManagedApp).mockResolvedValue(baseView("orca", true));
    const report = await runAppDeckPreflight("orca");
    expect(report.ready).toBe(false);
    const origin = report.checks.find((c) => c.id === "origin");
    expect(origin?.status).toBe("fail");
    expect(origin?.fixHint).toContain("NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE");
  });

  it("detects when the loopback port is already occupied before fresh install", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as net.AddressInfo;
    const catalog = await import("./catalog");
    const def = catalog.getManagedAppDefinition("t3");
    vi.spyOn(catalog, "getManagedAppDefinition").mockReturnValue({ ...def, dashboardUrl: `http://127.0.0.1:${port}` });
    try {
      const report = await runAppDeckPreflight("t3");
      expect(report.ready).toBe(false);
      expect(report.checks.find((c) => c.id === "port")?.status).toBe("fail");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
