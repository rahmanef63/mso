// Regressions for the MSO-owned Orca unit proof and strict service quiescence.
//
// P1 before: `isOwnedOrcaUnit` did a substring match on `ExecStart`, so a foreign
// executable ahead of the CLI, a `sh -c` wrapper, or a SECOND `ExecStart` was
// accepted; the unit read ignored a world-writable file/dir. And `running()`
// collapsed an owned unit's unavailable/missing state to "stopped", so a backup
// could proceed while systemd had said nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

const { runProgram } = await import("./runner");
const { getManagedApp, performManagedAppAction, assertManagedAppStopped } = await import("./manager");
const { getManagedAppDefinition } = await import("./catalog");
const { isOwnedOrcaUnit } = await import("./orca-unit-proof");
const { renderOrcaServiceUnit } = (await import("../../scripts/orca/systemd-unit.mjs")) as {
  renderOrcaServiceUnit: (options: Record<string, unknown>) => string;
};

const CLI = path.join(process.cwd(), "scripts", "orca", "cli.mjs");
const RENDER_ROOT = "/home/operator/.local/share/mso/orca";
const render = (over: Record<string, unknown> = {}) =>
  renderOrcaServiceUnit({
    hostNode: "/usr/bin/node",
    cliScript: CLI,
    managedRoot: RENDER_ROOT,
    port: 6769,
    advertisedEndpoint: "wss://orca.mso.example.com",
    ...over,
  });

describe("isOwnedOrcaUnit matches only the exact generated argv", () => {
  it("accepts the unit the real renderer writes", () => {
    expect(isOwnedOrcaUnit(render(), RENDER_ROOT, CLI)).toBe(true);
  });

  it("rejects a foreign executable placed ahead of the CLI", () => {
    expect(isOwnedOrcaUnit(render({ hostNode: "/tmp/evil" }), RENDER_ROOT, CLI)).toBe(false);
    expect(isOwnedOrcaUnit(render({ hostNode: "/usr/bin/node" }).replace("/usr/bin/node", "/tmp/evil"), RENDER_ROOT, CLI)).toBe(false);
  });

  it("rejects a shell wrapper that merely mentions the CLI", () => {
    const wrapped = render().replace(/^ExecStart=.*$/m, `ExecStart="/bin/sh" "-c" "${CLI} run"`);
    expect(isOwnedOrcaUnit(wrapped, RENDER_ROOT, CLI)).toBe(false);
  });

  it("rejects a duplicate or extra Exec hook", () => {
    expect(isOwnedOrcaUnit(`${render()}ExecStart=/bin/evil\n`, RENDER_ROOT, CLI)).toBe(false);
    expect(isOwnedOrcaUnit(render().replace("[Service]", "[Service]\nExecStartPre=/tmp/evil"), RENDER_ROOT, CLI)).toBe(false);
  });

  it("rejects another managed root or CLI", () => {
    expect(isOwnedOrcaUnit(render({ managedRoot: "/tmp/other" }), RENDER_ROOT, CLI)).toBe(false);
    expect(isOwnedOrcaUnit(render({ cliScript: "/tmp/evil/cli.mjs" }), RENDER_ROOT, CLI)).toBe(false);
  });
});

type Result = { code: number; stdout: string; stderr: string };
const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" });
const ACTIVE = "LoadState=loaded\nActiveState=active\n";
const STOPPED = "LoadState=loaded\nActiveState=inactive\n";
const NOT_FOUND = "LoadState=not-found\nActiveState=inactive\n";
const BUS_DOWN: Result = { code: 1, stdout: "", stderr: "Failed to connect to bus" };
const ADAPTER = getManagedAppDefinition("orca").command;

let home = "";
const root = () => path.join(home, ".local", "share", "mso", "orca");
const unitPath = () => path.join(home, ".config", "systemd", "user", "mso-orca.service");
const unitText = () => render({ cliScript: CLI, managedRoot: root() });
const writeOwned = async (mode = 0o644) => {
  await mkdir(path.dirname(unitPath()), { recursive: true });
  await writeFile(unitPath(), unitText(), { mode });
  await writeFile(path.join(root(), "managed-install.json"), "{}", { mode: 0o600 });
};
function programs(user: Result | string) {
  const asResult = (v: Result | string): Result => (typeof v === "string" ? ok(v) : v);
  vi.mocked(runProgram).mockImplementation(async (command: string, _args: readonly string[]) => {
    if (command === "systemctl") return asResult(user);
    if (command === ADAPTER) return ok("1.4.230\n");
    return ok();
  });
}
const lifecycleCalls = () => vi.mocked(runProgram).mock.calls.filter(([c, a]) => c === "systemctl" && !(a as string[]).includes("show"));

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "orca-unit-"));
  process.env.HOME = home;
  delete process.env.ORCA_HOME;
  await mkdir(root(), { recursive: true, mode: 0o700 });
  vi.mocked(runProgram).mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

describe("owned Orca unit file guards", () => {
  it("rejects a world-writable unit file", async () => {
    await writeOwned();
    await chmod(unitPath(), 0o666);
    programs(ACTIVE);
    expect((await getManagedApp("orca")).installed).toBe(false);
  });

  it("rejects a unit in a writable containing directory", async () => {
    await writeOwned();
    await chmod(path.dirname(unitPath()), 0o777);
    programs(ACTIVE);
    expect((await getManagedApp("orca")).installed).toBe(false);
  });
});

describe("strict quiescence never reads an unknown state as stopped", () => {
  it("refuses a backup while the user bus is unavailable", async () => {
    await writeOwned();
    programs(BUS_DOWN);
    const view = await getManagedApp("orca");
    expect(view.installed).toBe(true);
    expect(view.state).toBe("error");
    expect(view.diagnostic).toMatch(/unknown|not reported as stopped/i);

    await expect(assertManagedAppStopped("orca")).rejects.toThrow(/unknown/i);
    await expect(performManagedAppAction("orca", "backup")).rejects.toThrow(/unknown/i);
  });

  it("treats an owned unit systemd cannot load as ambiguous, not stopped", async () => {
    await writeOwned();
    programs(NOT_FOUND);
    expect((await getManagedApp("orca")).state).toBe("error");
    await expect(assertManagedAppStopped("orca")).rejects.toThrow(/unknown/i);
  });
});

describe("ordinary owned lifecycle is unchanged", () => {
  it("reports a stopped unit as stopped and starts only the USER unit", async () => {
    await writeOwned();
    programs(STOPPED);
    const view = await getManagedApp("orca");
    expect(view).toMatchObject({ installed: true, state: "stopped" });
    expect(view.supportedActions).toContain("start");

    await performManagedAppAction("orca", "start");
    for (const call of lifecycleCalls()) expect(call[1]).toEqual(["--user", "start", "mso-orca.service"]);
  });
});
