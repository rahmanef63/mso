// Regressions for the exact MSO-owned Orca unit proof and strict quiescence.
// Fixtures use the REAL renderer + REAL installer config builder, with a
// launcher hostNode deliberately different from release.nodeBinary.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("./runner", () => ({ runProgram: vi.fn(), commandExists: vi.fn().mockResolvedValue(false), resolveCommand: vi.fn().mockResolvedValue(null), requireProgram: vi.fn() }));
vi.mock("./user-bus", () => ({ userBusEnv: vi.fn(() => ({ XDG_RUNTIME_DIR: "/run/user/1000" })), userBusUnavailable: vi.fn(() => false) }));
vi.mock("./orca-readiness", () => ({ getOrcaReadiness: vi.fn() }));

const { runProgram } = await import("./runner");
const { getManagedApp, performManagedAppAction, assertManagedAppStopped } = await import("./manager");
const { getManagedAppDefinition } = await import("./catalog");
const { isOwnedOrcaUnit, proveOwnedOrcaUnit } = await import("./orca-unit-proof");
const { renderOrcaServiceUnit } = (await import("../../scripts/orca/systemd-unit.mjs")) as {
  renderOrcaServiceUnit: (options: Record<string, unknown>) => string;
};
const { buildPlannedConfig, buildServiceConfig } = await import("../../scripts/orca/managed-config.mjs");

const CLI = path.join(process.cwd(), "scripts", "orca", "cli.mjs");
const ADVERTISED = "wss://orca.mso.example.com";
let base = "";
const root = () => path.join(base, ".local", "share", "mso", "orca");
const unitPath = () => path.join(base, ".config", "systemd", "user", "mso-orca.service");
const configPath = () => path.join(root(), "managed-service.json");
const hostNode = () => path.join(base, "bin", "host-node");
const releaseNode = () => path.join(base, "release", "node");
const renderFor = (over: Record<string, unknown> = {}) =>
  renderOrcaServiceUnit({ hostNode: hostNode(), cliScript: CLI, managedRoot: root(), port: 6769, advertisedEndpoint: ADVERTISED, ...over });
const configFor = (over: Record<string, unknown> = {}) =>
  buildServiceConfig({
    plannedConfig: buildPlannedConfig({ root: root(), unitPath: unitPath(), fixedPort: 6769, advertised: ADVERTISED }),
    prepared: {
      releaseRoot: path.join(root(), "r"), slotDir: path.join(root(), "r", "slot"), webDir: path.join(root(), "r", "web"),
      nodeBinary: releaseNode(), receiptPath: path.join(root(), "r", "receipt.json"), receipt: { release: { contentId: "fixture" } },
    },
    installedAt: "2026-01-01T00:00:00.000Z",
    hostNode: hostNode(),
    cliScript: CLI,
    ...over,
  });
const writeConfig = (over: Record<string, unknown> = {}) => writeFile(configPath(), JSON.stringify(configFor(over)), { mode: 0o600 });
const tamperConfig = async (patch: Record<string, unknown>) => {
  const raw = JSON.parse(await readFile(configPath(), "utf8"));
  await writeFile(configPath(), JSON.stringify({ ...raw, ...patch }), { mode: 0o600 });
};
const writeStaleConfig = () => {
  const { hostNode: _host, cliScript: _cli, ...old } = configFor();
  return writeFile(configPath(), JSON.stringify(old), { mode: 0o600 });
};
const writeOwned = async (over: Record<string, unknown> = {}, mode = 0o644) => {
  await mkdir(path.dirname(unitPath()), { recursive: true });
  await writeFile(unitPath(), renderFor(over), { mode });
  await writeConfig();
  await writeFile(path.join(root(), "managed-install.json"), "{}", { mode: 0o600 });
};

type Result = { code: number; stdout: string; stderr: string };
const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" });
const ACTIVE = "LoadState=loaded\nActiveState=active\n";
const STOPPED = "LoadState=loaded\nActiveState=inactive\n";
const NOT_FOUND = "LoadState=not-found\nActiveState=inactive\n";
const BUS_DOWN: Result = { code: 1, stdout: "", stderr: "Failed to connect to bus" };
const ADAPTER = getManagedAppDefinition("orca").command;
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
  base = await mkdtemp(path.join(tmpdir(), "orca-unit-"));
  process.env.HOME = base;
  delete process.env.ORCA_HOME;
  await mkdir(root(), { recursive: true, mode: 0o700 });
  await chmod(root(), 0o700);
  for (const node of [hostNode(), releaseNode()]) {
    await mkdir(path.dirname(node), { recursive: true, mode: 0o700 });
    await writeFile(node, "#!/bin/sh\n", { mode: 0o755 });
    await chmod(node, 0o755);
  }
  vi.mocked(runProgram).mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(base, { recursive: true, force: true });
});

describe("isOwnedOrcaUnit accepts only the exact generated unit", () => {
  it("accepts the unit the real renderer writes for the real config builder", async () => {
    await writeConfig();
    const built = configFor() as { hostNode?: string; release?: { nodeBinary?: string } };
    expect(built.hostNode).not.toBe(built.release?.nodeBinary);
    expect(await isOwnedOrcaUnit(renderFor(), root(), CLI)).toBe(true);
  });
  it("rejects an arbitrary /tmp node even when it is named node", async () => {
    await writeConfig();
    expect(await isOwnedOrcaUnit(renderFor({ hostNode: "/tmp/node" }), root(), CLI)).toBe(false);
    await writeConfig({ hostNode: "/tmp/node" });
    expect(await isOwnedOrcaUnit(renderFor({ hostNode: "/tmp/node" }), root(), CLI)).toBe(false);
  });
  it("rejects altered WorkingDirectory, EnvironmentFile, or User directives", async () => {
    await writeConfig();
    const unit = renderFor();
    expect(await isOwnedOrcaUnit(unit.replace(/^WorkingDirectory=.*$/m, 'WorkingDirectory="/tmp/evil"'), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(unit.replace("[Service]", "[Service]\nEnvironmentFile=/tmp/evil"), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(unit.replace("[Service]", "[Service]\nUser=root"), root(), CLI)).toBe(false);
  });
  it("rejects duplicate sections, an extra Exec hook, or a runtime flag", async () => {
    await writeConfig();
    const unit = renderFor();
    expect(await isOwnedOrcaUnit(unit.replace("[Service]", "[Service]\n[Service]"), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(unit.replace("[Service]", "[Service]\nExecStartPre=/tmp/evil"), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(unit.replace(/^ExecStart=(.*)$/m, (_m, line) => `ExecStart=${line} "--bind" "0.0.0.0"`), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(`${unit}UnknownDirective=1\n`, root(), CLI)).toBe(false);
  });
  it("rejects another root, CLI, port, missing endpoint, or CRLF", async () => {
    await writeConfig();
    const unit = renderFor();
    expect(await isOwnedOrcaUnit(renderFor({ managedRoot: path.join(base, "other") }), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(renderFor({ cliScript: "/tmp/evil/cli.mjs" }), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(unit.replace('"--port" "6769"', '"--port" "70000"'), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(unit.replace(/ "--advertised-endpoint" "[^"]+"/, ""), root(), CLI)).toBe(false);
    expect(await isOwnedOrcaUnit(unit.replace(/\n/g, "\r\n"), root(), CLI)).toBe(false);
  });
  it("refuses an absent, world-readable, mismatched, or unknown-node receipt", async () => {
    expect(await isOwnedOrcaUnit(renderFor(), root(), CLI)).toBe(false);
    await writeConfig();
    await chmod(configPath(), 0o644);
    expect(await isOwnedOrcaUnit(renderFor(), root(), CLI)).toBe(false);
    await writeConfig();
    await tamperConfig({ managedRoot: path.join(base, "other") });
    expect(await isOwnedOrcaUnit(renderFor(), root(), CLI)).toBe(false);
    await writeConfig();
    await tamperConfig({ port: 70000 });
    expect(await isOwnedOrcaUnit(renderFor(), root(), CLI)).toBe(false);
    await writeConfig({ hostNode: path.join(base, "unknown-node") });
    expect(await isOwnedOrcaUnit(renderFor(), root(), CLI)).toBe(false);
  });
  it("demands a reinstall for an old receipt without launcher identity", async () => {
    await writeOwned();
    await writeStaleConfig();
    expect(await proveOwnedOrcaUnit(renderFor(), root(), CLI)).toBe("reinstall-required");
    programs(ACTIVE);
    const view = await getManagedApp("orca");
    expect(view.installed).toBe(false);
    expect(view.diagnostic).toMatch(/reinstall/i);
  });
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
  it("rejects a unit that does not match the trusted receipt", async () => {
    await writeOwned();
    await writeFile(unitPath(), renderFor({ managedRoot: path.join(base, "other") }), { mode: 0o644 });
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
