import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
const { getOrcaReadiness } = await import("./orca-readiness");
const { getManagedApp, performManagedAppAction } = await import("./manager");
const { getManagedAppDefinition } = await import("./catalog");
const { renderOrcaServiceUnit } = (await import("../../scripts/orca/systemd-unit.mjs")) as {
  renderOrcaServiceUnit: (options: Record<string, unknown>) => string;
};
const { buildPlannedConfig, buildServiceConfig } = await import("../../scripts/orca/managed-config.mjs");

const ADAPTER = getManagedAppDefinition("orca").command;
const READY = {
  available: true as const, pairingUrl: "orca://pair?code=private", webClientUrl: "http://127.0.0.1:6769/web-index.html",
  runtimeId: "runtime-abc", serverPid: 4242, boundEndpoint: "ws://127.0.0.1:6769", advertisedEndpoint: "wss://orca.mso.example.com",
};
const ACTIVE = "LoadState=loaded\nActiveState=active\n";
const STOPPED = "LoadState=loaded\nActiveState=inactive\n";
const NOT_FOUND = "LoadState=not-found\nActiveState=inactive\n";
type Result = { code: number; stdout: string; stderr: string };
const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" });

let home = "";
const root = () => path.join(home, ".local", "share", "mso", "orca");
const unitPath = () => path.join(home, ".config", "systemd", "user", "mso-orca.service");
const hostNode = () => path.join(home, "bin", "host-node");
const releaseNode = () => path.join(home, "release", "node");

// The exact unit `renderOrcaServiceUnit` writes for this repo's canonical CLI
// and the resolved managed root. The launcher node is the host node the
// installer actually rendered, deliberately DIFFERENT from release.nodeBinary.
const CLI = path.join(process.cwd(), "scripts", "orca", "cli.mjs");
const ADVERTISED = "wss://orca.mso.example.com";
function unitText({ cli = CLI, managedRoot = root() } = {}) {
  return renderOrcaServiceUnit({
    hostNode: hostNode(),
    cliScript: cli,
    managedRoot,
    port: 6769,
    advertisedEndpoint: ADVERTISED,
  });
}
const configFor = () =>
  buildServiceConfig({
    plannedConfig: buildPlannedConfig({ root: root(), unitPath: unitPath(), fixedPort: 6769, advertised: ADVERTISED }),
    prepared: {
      releaseRoot: path.join(root(), "r"), slotDir: path.join(root(), "r", "slot"), webDir: path.join(root(), "r", "web"),
      nodeBinary: releaseNode(), receiptPath: path.join(root(), "r", "receipt.json"), receipt: { release: { contentId: "fixture" } },
    },
    installedAt: "2026-01-01T00:00:00.000Z",
    hostNode: hostNode(),
    cliScript: CLI,
  });
async function writeOwnedUnit(overrides = {}) {
  await mkdir(path.dirname(unitPath()), { recursive: true });
  await writeFile(unitPath(), unitText(overrides), { mode: 0o644 });
  await writeFile(path.join(root(), "managed-service.json"), JSON.stringify(configFor()), { mode: 0o600 });
}
const writeReceipt = () => writeFile(path.join(root(), "managed-install.json"), "{}", { mode: 0o600 });

/** user/system scope unit stdout + adapter `--version` outcome, per test. */
function programs({ user = NOT_FOUND, system = NOT_FOUND, adapter }: { user?: Result | string; system?: Result | string; adapter?: Result }) {
  const asResult = (v: Result | string): Result => (typeof v === "string" ? ok(v) : v);
  vi.mocked(runProgram).mockImplementation(async (command: string, args: readonly string[]) => {
    if (command === "systemctl") {
      if (args.includes("show")) return args[0] === "--user" ? asResult(user) : asResult(system);
      // A real user-bus outage fails every `--user` call, not just `show`.
      return args[0] === "--user" ? asResult(user) : asResult(system);
    }
    if (command === ADAPTER) return adapter ?? { code: 1, stdout: "", stderr: "not installed" };
    return ok();
  });
}
const callLog = () => vi.mocked(runProgram).mock.calls as Array<[string, string[]]>;
const lifecycleCalls = () => callLog().filter(([c, a]) => c === "systemctl" && !a.includes("show"));

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "orca-mgr-"));
  process.env.HOME = home;
  delete process.env.ORCA_HOME;
  await mkdir(root(), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(hostNode()), { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(releaseNode()), { recursive: true, mode: 0o700 });
  await writeFile(hostNode(), "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(releaseNode(), "#!/bin/sh\n", { mode: 0o755 });
  await chmod(hostNode(), 0o755);
  await chmod(releaseNode(), 0o755);
  vi.mocked(runProgram).mockReset();
  vi.mocked(getOrcaReadiness).mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

describe("Orca manager ownership", () => {
  it("refuses an unrelated same-name SYSTEM unit instead of calling it installed", async () => {
    programs({ user: NOT_FOUND, system: ACTIVE });
    const view = await getManagedApp("orca");
    expect(view.installed).toBe(false);
    expect(view.state).toBe("not-installed");
    expect(view.supportedActions).toEqual([]);
    expect(view.diagnostic).toMatch(/did not create|foreign/i);

    await expect(performManagedAppAction("orca", "stop")).rejects.toThrow(/did not create|foreign/i);
    expect(lifecycleCalls()).toEqual([]);
  });

  it("does not treat a Docker container or a PATH binary as an Orca install", async () => {
    programs({});
    await expect(getManagedApp("orca")).resolves.toMatchObject({ state: "not-installed" });
    expect(lifecycleCalls()).toEqual([]);
  });

  it("requires a verified install receipt: missing and invalid both stay not-installed", async () => {
    await writeOwnedUnit();
    programs({ user: ACTIVE });
    expect((await getManagedApp("orca")).diagnostic).toMatch(/install receipt/i);

    await writeReceipt();
    programs({ user: ACTIVE, adapter: { code: 1, stdout: "", stderr: "not installed" } });
    expect((await getManagedApp("orca")).diagnostic).toMatch(/install receipt/i);
  });

  it("reports a stopped MSO-owned USER unit (verified receipt) as stopped, not running", async () => {
    await writeOwnedUnit();
    await writeReceipt();
    programs({ user: STOPPED, adapter: ok("1.4.230\n") });
    const view = await getManagedApp("orca");
    expect(view.installed).toBe(true);
    expect(view.state).toBe("stopped");
    expect(view.supportedActions).toContain("start");
  });

  it("reports a running MSO-owned USER unit as running only when readiness verifies", async () => {
    await writeOwnedUnit();
    await writeReceipt();
    programs({ user: ACTIVE, adapter: ok("1.4.230\n") });
    vi.mocked(getOrcaReadiness).mockResolvedValue(READY);
    expect(await getManagedApp("orca")).toMatchObject({ state: "running", healthy: true });
  });

  it("uses the exact USER unit argv for actions and never the system scope", async () => {
    await writeOwnedUnit();
    await writeReceipt();
    programs({ user: ACTIVE, adapter: ok("1.4.230\n") });
    await performManagedAppAction("orca", "stop");
    const stops = lifecycleCalls().filter(([, a]) => a.includes("stop"));
    expect(stops.length).toBeGreaterThan(0);
    for (const [, args] of stops) expect(args).toEqual(["--user", "stop", "mso-orca.service"]);
    expect(callLog().some(([c, a]) => c === "systemctl" && a[0] === "stop")).toBe(false);
  });

  it("keeps a user-bus outage user-scope only: refuses without touching the system unit", async () => {
    await writeOwnedUnit();
    await writeReceipt();
    programs({ user: { code: 1, stdout: "", stderr: "Failed to connect to bus" }, system: ACTIVE, adapter: ok("1.4.230\n") });
    const view = await getManagedApp("orca");
    expect(view.installed).toBe(true);

    await expect(performManagedAppAction("orca", "start")).rejects.toThrow(/systemctl --user start/);
    expect(callLog().some(([c, a]) => c === "systemctl" && a[0] === "start")).toBe(false);
  });

  it("leaves generic apps on the generic detection path", async () => {
    programs({ system: ACTIVE });
    const hermes = await getManagedApp("hermes");
    expect(hermes.installed).toBe(true);
  });

  it("refuses a unit reached through a symlinked ancestor", async () => {
    const real = path.join(home, "realconfig");
    await mkdir(path.join(real, "systemd", "user"), { recursive: true });
    await writeFile(path.join(real, "systemd", "user", "mso-orca.service"), unitText(), { mode: 0o644 });
    await symlink(real, path.join(home, ".config"));
    await writeReceipt();
    programs({ user: ACTIVE, adapter: ok("1.4.230\n") });
    const view = await getManagedApp("orca");
    expect(view.installed).toBe(false);
    expect(view.state).toBe("not-installed");
    expect(view.supportedActions).toEqual([]);
  });

  it("refuses a unit whose marker regex alone matches but points at another root or CLI", async () => {
    await writeOwnedUnit({ managedRoot: path.join(home, "other-root") });
    await writeReceipt();
    programs({ user: ACTIVE, adapter: ok("1.4.230\n") });
    expect((await getManagedApp("orca")).installed).toBe(false);

    await writeOwnedUnit({ cli: "/tmp/evil/cli.mjs" });
    programs({ user: ACTIVE, adapter: ok("1.4.230\n") });
    expect((await getManagedApp("orca")).installed).toBe(false);
  });

  it("refuses a receipt whose adapter version is not the pinned one", async () => {
    await writeOwnedUnit();
    await writeReceipt();
    programs({ user: ACTIVE, adapter: ok("1.9.9\n") });
    const view = await getManagedApp("orca");
    expect(view.installed).toBe(false);
    expect(view.diagnostic).toMatch(/install receipt/i);
  });
});
