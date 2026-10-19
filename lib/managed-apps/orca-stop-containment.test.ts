import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
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
const RUNNING = "LoadState=loaded\nActiveState=active\n";
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
      releaseRoot: path.join(root(), "r"),
      slotDir: path.join(root(), "r", "slot"),
      webDir: path.join(root(), "r", "web"),
      nodeBinary: releaseNode(),
      receiptPath: path.join(root(), "r", "receipt.json"),
      receipt: { release: { contentId: "fixture" } },
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
let isRunning = true;

function setupRunnerMock() {
  vi.mocked(runProgram).mockImplementation(async (command: string, args: readonly string[]) => {
    if (command === "systemctl") {
      if (args.includes("show")) {
        return ok(isRunning ? RUNNING : STOPPED);
      }
      if (args.includes("stop")) {
        isRunning = false;
        return ok();
      }
      return ok();
    }
    if (command === ADAPTER) return adapterResult;
    return ok();
  });
}

const callLog = () => vi.mocked(runProgram).mock.calls as Array<[string, string[], number?, Record<string, string>?]>;
const lifecycleCalls = () =>
  callLog()
    .filter(([c, a]) => c === "systemctl" && !a.includes("show"))
    .map(([c, a]) => [c, a]);

describe("Orca stop containment despite corrupt release", () => {
  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "orca-stop-"));
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
    isRunning = true;
    setupRunnerMock();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(home, { recursive: true, force: true });
  });

  it("after primed valid status adapter fail: start/restart/backup deny, but stop succeeds once and reports integrity diagnostic", async () => {
    await writeOwnedFixture();

    // 1. Prime valid status
    const initialView = await getManagedApp("orca");
    expect(initialView.installed).toBe(true);
    expect(initialView.state).toBe("running");
    expect(initialView.supportedActions).toContain("stop");

    // 2. Adapter fails (checksum mismatch / corrupt release)
    adapterResult = { code: 1, stdout: "", stderr: "checksum mismatch / corrupt release" };

    // 3. start, restart, backup deny; strict backup remains refused
    await expect(performManagedAppAction("orca", "start")).rejects.toThrow(/install receipt|cannot prove absence/i);
    await expect(performManagedAppAction("orca", "restart")).rejects.toThrow(/install receipt|cannot prove absence/i);
    await expect(performManagedAppAction("orca", "backup")).rejects.toThrow(/install receipt|cannot prove absence/i);
    await expect(assertManagedAppStopped("orca")).rejects.toThrow(/install receipt|cannot prove absence/i);
    expect(lifecycleCalls()).toEqual([]);

    // 4. UI view offers stop with meaningful minimal state without marking install fully verified
    const unverifiedView = await getManagedApp("orca");
    expect(unverifiedView.installed).toBe(false);
    expect(unverifiedView.state).toBe("running");
    expect(unverifiedView.supportedActions).toEqual(["stop"]);
    expect(unverifiedView.diagnostic).toMatch(/install receipt/i);

    // 5. stop containment succeeds and invokes exact systemctl --user stop mso-orca.service once
    const stopView = await performManagedAppAction("orca", "stop");
    expect(lifecycleCalls()).toEqual([["systemctl", ["--user", "stop", "mso-orca.service"]]]);
    expect(stopView.installed).toBe(false);
    expect(stopView.state).toBe("stopped");
    expect(stopView.diagnostic).toMatch(/install receipt/i);
    expect(stopView.supportedActions).toEqual(["stop"]);

    // Strict backup still refused even after stop
    await expect(assertManagedAppStopped("orca")).rejects.toThrow(/install receipt|cannot prove absence/i);
  });

  it("foreign unit denies stop and never invokes systemctl stop", async () => {
    await writeOwnedFixture();
    // Tamper unit with foreign content (missing MSO marker)
    await writeFile(unitPath(), "[Unit]\nDescription=Foreign\n[Service]\nExecStart=/bin/sleep 100\n", { mode: 0o644 });

    const view = await getManagedApp("orca");
    expect(view.installed).toBe(false);
    expect(view.supportedActions).not.toContain("stop");

    await expect(performManagedAppAction("orca", "stop")).rejects.toThrow(/refusing to manage|operation unsupported|not an MSO-owned/i);
    expect(lifecycleCalls()).toEqual([]);
  });

  it("metadata ownership loss denies stop and never invokes systemctl stop", async () => {
    await writeOwnedFixture();
    // Remove trusted config (managed-service.json)
    await unlink(path.join(root(), "managed-service.json"));

    const view = await getManagedApp("orca");
    expect(view.installed).toBe(false);
    expect(view.supportedActions).not.toContain("stop");

    await expect(performManagedAppAction("orca", "stop")).rejects.toThrow(/reinstall|refusing to manage|operation unsupported|not an MSO-owned/i);
    expect(lifecycleCalls()).toEqual([]);
  });
});
