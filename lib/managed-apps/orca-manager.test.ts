import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runner", () => ({
  runProgram: vi.fn(),
  commandExists: vi.fn().mockResolvedValue(false),
  resolveCommand: vi.fn().mockResolvedValue(null),
  requireProgram: vi.fn(),
}));
vi.mock("./user-bus", () => ({
  userBusEnv: vi.fn(() => ({ XDG_RUNTIME_DIR: "/run/user/1000" })),
  userBusUnavailable: vi.fn(() => false),
}));
vi.mock("./orca-readiness", () => ({ getOrcaReadiness: vi.fn() }));

const { runProgram, commandExists } = await import("./runner");
const { getOrcaReadiness } = await import("./orca-readiness");
const { getManagedApp } = await import("./manager");
const { getManagedAppDefinition } = await import("./catalog");

// Orca health is the bridge's fail-closed live reading, so a unit that is merely
// `active` is not enough: the readiness identity must also verify.
const READY = {
  available: true as const,
  pairingUrl: "orca://pair?code=private",
  webClientUrl: "http://127.0.0.1:6769/web-index.html",
  runtimeId: "runtime-abc",
  serverPid: 4242,
  boundEndpoint: "ws://127.0.0.1:6769",
  advertisedEndpoint: "wss://orca.mso.example.com",
};

const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const NOT_FOUND = ok("LoadState=not-found\nActiveState=inactive\n");
const ACTIVE = ok("LoadState=loaded\nActiveState=active\n");
const STOPPED = ok("LoadState=loaded\nActiveState=inactive\n");

function mockSystemctl(byUnit: Record<string, { code: number; stdout: string; stderr: string }>) {
  vi.mocked(runProgram).mockImplementation(async (command: string, args: readonly string[]) => {
    if (command === "systemctl" && args.includes("show")) {
      const unit = args[args.length - 1];
      return byUnit[unit] ?? NOT_FOUND;
    }
    return ok("");
  });
}

describe("Orca catalog & manager installation contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT consider orca installed even if orca binary exists on PATH", async () => {
    mockSystemctl({});
    vi.mocked(commandExists).mockImplementation(async (cmd: string) => {
      return cmd === "orca-ide" || cmd === "scripts/managed-app-orca";
    });

    const view = await getManagedApp("orca");
    expect(view.state).toBe("not-installed");
    expect(view.supportedActions).toEqual([]);
  });

  it("does NOT count Docker container as installed for Orca (no generic docker detection)", async () => {
    mockSystemctl({});
    vi.mocked(commandExists).mockImplementation(async (cmd: string) => cmd === "docker");
    vi.mocked(runProgram).mockImplementation(async (command: string, args: readonly string[]) => {
      if (command === "systemctl") return NOT_FOUND;
      if (command === "docker" && args[0] === "ps") return ok("orca\n");
      if (command === "docker" && args[0] === "inspect") return ok("true\n");
      return ok("");
    });

    const view = await getManagedApp("orca");
    expect(view.state).toBe("not-installed");
  });

  it("detects running state when mso-orca.service is active and readiness verifies", async () => {
    mockSystemctl({ "mso-orca.service": ACTIVE });
    vi.mocked(getOrcaReadiness).mockResolvedValue(READY);
    const view = await getManagedApp("orca");
    expect(view.state).toBe("running");
    expect(view.supportedActions).toContain("stop");
    expect(view.supportedActions).toContain("restart");
  });

  it("detects stopped state when mso-orca.service is loaded but inactive", async () => {
    mockSystemctl({ "mso-orca.service": STOPPED });
    const view = await getManagedApp("orca");
    expect(view.state).toBe("stopped");
    expect(view.supportedActions).toContain("start");
  });

  it("uses the fail-closed bridge readiness reading for Orca health, not a static fetch", async () => {
    mockSystemctl({ "mso-orca.service": ACTIVE });

    const def = getManagedAppDefinition("orca");
    expect(def.dashboardUrl).toMatch(/6769/);
    expect(def.healthPath).toBe("/web-index.html");

    vi.mocked(getOrcaReadiness).mockResolvedValue(READY);
    const view = await getManagedApp("orca");
    expect(view.healthy).toBe(true);
    expect(getOrcaReadiness).toHaveBeenCalled();

    // A runtime whose identity does not verify reads unhealthy while the unit
    // stays active — a bare HTTP 200 is never accepted as ownership.
    vi.mocked(getOrcaReadiness).mockResolvedValue({ available: false, reason: "not_ready" });
    const degraded = await getManagedApp("orca");
    expect(degraded.state).toBe("unhealthy");
    expect(degraded.healthy).toBe(false);
  });
});
