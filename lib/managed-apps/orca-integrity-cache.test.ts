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
const { renderOrcaServiceUnit } = (await import("../../scripts/orca/systemd-unit.mjs")) as {
  renderOrcaServiceUnit: (options: Record<string, unknown>) => string;
};
const { buildPlannedConfig, buildServiceConfig } = await import("../../scripts/orca/managed-config.mjs");

const ADAPTER = getManagedAppDefinition("orca").command;
const STOPPED = "LoadState=loaded\nActiveState=inactive\n";
type Result = { code: number; stdout: string; stderr: string };
const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" });

let home = "";
const root = () => path.join(home, ".local", "share", "mso", "orca");
const unitPath = () => path.join(home, ".config", "systemd", "user", "mso-orca.service");
const hostNode = () => path.join(home, "bin", "host-node");
const releaseNode = () => path.join(home, "release", "node");
const receiptPath = () => path.join(root(), "managed-install.json");

const CLI = path.join(process.cwd(), "scripts", "orca", "cli.mjs");
const ADVERTISED = "wss://orca.mso.example.com";

function unitText() {
  return renderOrcaServiceUnit({
    hostNode: hostNode(),
    cliScript: CLI,
    managedRoot: root(),
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

async function writeOwnedFixture() {
  await mkdir(path.dirname(unitPath()), { recursive: true });
  await writeFile(unitPath(), unitText(), { mode: 0o644 });
  await writeFile(path.join(root(), "managed-service.json"), JSON.stringify(configFor()), { mode: 0o600 });
  await writeFile(receiptPath(), "{}", { mode: 0o600 });
}

let adapterResult: Result = ok("1.4.230\n");

function setupRunnerMock() {
  vi.mocked(runProgram).mockImplementation(async (command: string, args: readonly string[]) => {
    if (command === "systemctl") {
      if (args.includes("show")) return ok(STOPPED);
      return ok();
    }
    if (command === ADAPTER) return adapterResult;
    return ok();
  });
}

const callLog = () => vi.mocked(runProgram).mock.calls as Array<[string, string[]]>;
const lifecycleCalls = () => callLog().filter(([c, a]) => c === "systemctl" && !a.includes("show"));

describe("Orca cache integrity and mutation regression", () => {
  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "orca-cache-"));
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
    adapterResult = ok("1.4.230\n");
    setupRunnerMock();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  it("primes status cache then refuses start without systemctl when adapter returns invalid", async () => {
    await writeOwnedFixture();

    // 1. Prime real detectOrca path status cache with valid generated unit and private config
    const initialView = await getManagedApp("orca");
    expect(initialView.installed).toBe(true);
    expect(initialView.state).toBe("stopped");

    // 2. Adapter returns invalid without changing receipt
    adapterResult = { code: 1, stdout: "", stderr: "checksum mismatch / corrupt" };

    // 3. performManagedAppAction('orca', 'start') must refuse before systemctl
    await expect(performManagedAppAction("orca", "start")).rejects.toThrow(/install receipt|cannot prove absence/i);
    expect(lifecycleCalls()).toEqual([]);
  });

  it("rejects install receipt with 0666 permissions", async () => {
    await writeOwnedFixture();
    await chmod(receiptPath(), 0o666);

    const view = await getManagedApp("orca");
    expect(view.installed).toBe(false);
    expect(view.diagnostic).toMatch(/install receipt/i);

    await expect(performManagedAppAction("orca", "start")).rejects.toThrow(/install receipt/i);
    expect(lifecycleCalls()).toEqual([]);
  });

  it("strict assertManagedAppStopped performs fresh verification even with primed cache", async () => {
    await writeOwnedFixture();

    // Prime status cache
    const initialView = await getManagedApp("orca");
    expect(initialView.installed).toBe(true);
    expect(initialView.state).toBe("stopped");

    // Adapter now fails without receipt file change
    adapterResult = { code: 1, stdout: "", stderr: "tampered" };

    // Strict stopped check must fail closed via fresh verification
    await expect(assertManagedAppStopped("orca")).rejects.toThrow(/install receipt|cannot prove absence/i);
  });
});
