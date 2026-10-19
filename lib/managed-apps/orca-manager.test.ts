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

const { runProgram, commandExists } = await import("./runner");
const { getManagedApp } = await import("./manager");
const { getManagedAppDefinition } = await import("./catalog");

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

  it("detects running state when mso-orca.service is active", async () => {
    mockSystemctl({ "mso-orca.service": ACTIVE });
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

  it("targets port 6769 and /web-index.html for static reachability check", async () => {
    mockSystemctl({ "mso-orca.service": ACTIVE });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html>", { status: 200 }),
    );

    const def = getManagedAppDefinition("orca");
    expect(def.dashboardUrl).toMatch(/6769/);
    expect(def.healthPath).toBe("/web-index.html");

    const view = await getManagedApp("orca");
    expect(view.healthy).toBe(true);

    const healthCall = fetchSpy.mock.calls.find(([url]) => String(url).includes("6769"));
    expect(healthCall).toBeDefined();
    expect(String(healthCall![0])).toContain(":6769/web-index.html");
  });
});
