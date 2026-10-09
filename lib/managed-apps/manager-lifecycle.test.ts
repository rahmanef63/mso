// Regressions: stopped versus missing service detection, and backups of real installs.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runner", () => ({
  runProgram: vi.fn(),
  commandExists: vi.fn().mockResolvedValue(false),
  resolveCommand: vi.fn().mockResolvedValue(null),
  requireProgram: vi.fn(),
}));
// Stub the host user bus so service behavior is deterministic.
vi.mock("./user-bus", () => ({
  userBusEnv: vi.fn(() => ({ XDG_RUNTIME_DIR: "/run/user/1000" })),
  userBusUnavailable: vi.fn(() => false),
}));

const { runProgram, commandExists } = await import("./runner");
const { getManagedApp, performManagedAppAction } = await import("./manager");

const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
/** systemd 255 on an unknown unit: rc 0 from `show`, LoadState=not-found. */
const NOT_FOUND = ok("LoadState=not-found\nActiveState=inactive\n");
const ACTIVE = ok("LoadState=loaded\nActiveState=active\n");
const STOPPED = ok("LoadState=loaded\nActiveState=inactive\n");

afterEach(() => vi.restoreAllMocks());

it("reports a live Hermes gateway and stops every installed unit in both scopes", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "mso-service-set-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  const states: Record<string, typeof ACTIVE> = { "hermes-dashboard.service": STOPPED, "hermes-gateway.service": ACTIVE };
  vi.mocked(runProgram).mockImplementation(async (command, args) => {
    const unit = args[args.length - 1];
    if (command === "systemctl" && args.includes("show")) return states[unit] ?? NOT_FOUND;
    if (command === "systemctl" && args.includes("stop") && states[unit]) { states[unit] = STOPPED; return ok(""); }
    return ok("");
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  expect((await getManagedApp("hermes")).state).toBe("running");
  expect((await performManagedAppAction("hermes", "stop")).state).toBe("stopped");
  for (const unit of Object.keys(states)) expect(vi.mocked(runProgram).mock.calls.some(([command, args]) => command === "systemctl" && args.includes("stop") && args.includes(unit))).toBe(true);
  await fs.rm(home, { recursive: true, force: true });
});

it("stops every discovered Hermes container before reporting stopped", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "mso-container-set-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.mocked(commandExists).mockImplementation(async command => command === "docker");
  const states = new Map([["hermes", true], ["hermes-dashboard", true]]);
  vi.mocked(runProgram).mockImplementation(async (command, args) => {
    if (command === "systemctl") return NOT_FOUND;
    if (command === "docker" && args[0] === "ps") return ok([...states.keys()].join("\n"));
    if (command === "docker" && args[0] === "inspect") return ok(String(states.get(args[args.length - 1])));
    if (command === "docker" && args[0] === "stop") states.set(args[1], false);
    return ok("");
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  expect((await getManagedApp("hermes")).state).toBe("running");
  expect((await performManagedAppAction("hermes", "stop")).state).toBe("stopped");
  expect([...states.values()]).toEqual([false, false]);
  await fs.rm(home, { recursive: true, force: true });
});

it("treats a system-scope gateway as live even if the user-scope instance is inactive", async () => {
  vi.mocked(runProgram).mockImplementation(async (command, args) => command === "systemctl" && args.includes("show") && args.includes("hermes-gateway.service") ? args.includes("--user") ? STOPPED : ACTIVE : NOT_FOUND);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  expect((await getManagedApp("hermes")).state).toBe("running");
  const { assertManagedAppStopped } = await import("./manager");
  await expect(assertManagedAppStopped("hermes")).rejects.toThrow(/stop all/);
});

