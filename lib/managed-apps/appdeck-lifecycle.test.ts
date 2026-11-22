import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedAppJob } from "./types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  running: true,
  stopCalls: 0,
  startCalls: 0,
  stopFail: false,
}));

vi.mock("./manager", () => ({
  assertManagedAppStopped: vi.fn(async () => {
    if (mocks.running) throw new Error("Cannot confirm app is stopped; stop all app services before backup or restore");
  }),
  stopManagedAppForMaintenance: vi.fn(async () => {
    mocks.stopCalls += 1;
    if (mocks.stopFail) throw new Error("docker stop failed");
    if (!mocks.running) return false;
    mocks.running = false;
    return true;
  }),
  startManagedAppForRecovery: vi.fn(async () => {
    mocks.startCalls += 1;
    mocks.running = true;
    return true;
  }),
}));

delete process.env.N8N_DATA;

const { startUpdate, startUninstall } = await import("./update");
const { readManagedAppJob } = await import("./jobs");
const { liveRecord } = await import("./job-runner");
const { listBackups } = await import("./backups");
const catalog = await import("./catalog");

let home: string;
let bin: string;
const realPath = process.env.PATH ?? "";
const realHome = process.env.HOME;

async function stub(name: string, body: string): Promise<string> {
  const file = path.join(bin, name);
  await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

async function settle(job: ManagedAppJob): Promise<ManagedAppJob> {
  for (let i = 0; i < 400; i += 1) {
    const current = await readManagedAppJob(job.id);
    if (current && current.status !== "queued" && current.status !== "running" && !liveRecord(job.id)) return current;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job never settled");
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "appdeck-life-"));
  bin = path.join(home, "bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.mkdir(path.join(home, ".n8n"), { recursive: true });
  await fs.writeFile(path.join(home, ".n8n", "config"), '{"encryptionKey":"demo"}\n');
  vi.spyOn(os, "homedir").mockReturnValue(home);
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.HOME = home;
  mocks.running = true;
  mocks.stopCalls = 0;
  mocks.startCalls = 0;
  mocks.stopFail = false;
});

afterEach(async () => {
  process.env.PATH = realPath;
  if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

describe("AppDeck transactional lifecycle (auto-quiesce + backup + auto-recovery)", () => {
  it("automatically pauses a running n8n app before taking the pre-update backup and applying the update", async () => {
    const script = await stub("managed-app-n8n", 'echo "[appdeck] step=apply updating n8n"\necho "[appdeck] step=ready done"');
    const def = catalog.getManagedAppDefinition("n8n");
    vi.spyOn(catalog, "getManagedAppDefinition").mockReturnValue({ ...def, command: script, homeDir: path.join(home, ".n8n") });

    const job = await settle(await startUpdate("n8n"));
    expect(job.status).toBe("succeeded");
    expect(mocks.stopCalls).toBe(1);
    expect(mocks.startCalls).toBe(0);
    expect(job.log).toContain("[appdeck] step=quiesce Paused n8n safely");
    expect(job.log).toContain("[appdeck] step=backup Creating pre-update backup");
    expect((await listBackups("n8n"))[0]?.reason).toBe("pre-update");
  });

  it("automatically restarts the previous n8n service when the update command fails", async () => {
    const script = await stub("managed-app-n8n", 'echo "pull failed: registry timeout" >&2\nexit 1');
    const def = catalog.getManagedAppDefinition("n8n");
    vi.spyOn(catalog, "getManagedAppDefinition").mockReturnValue({ ...def, command: script, homeDir: path.join(home, ".n8n") });

    const job = await settle(await startUpdate("n8n"));
    expect(job.status).toBe("failed");
    expect(mocks.stopCalls).toBe(1);
    expect(mocks.startCalls).toBe(1);
    expect(mocks.running).toBe(true);
    expect(job.log).toContain("[appdeck] step=recover Recovering previous n8n service");
    expect(job.log).toContain("[appdeck] step=recover n8n is back online");
  });

  it("automatically pauses a running app before pre-uninstall backup and removal", async () => {
    const script = await stub("managed-app-n8n", 'echo "[appdeck] step=ready removed n8n"');
    const def = catalog.getManagedAppDefinition("n8n");
    vi.spyOn(catalog, "getManagedAppDefinition").mockReturnValue({ ...def, command: script, homeDir: path.join(home, ".n8n") });

    const job = await settle(await startUninstall("n8n", "n8n"));
    expect(job.status).toBe("succeeded");
    expect(mocks.stopCalls).toBe(1);
    expect((await listBackups("n8n"))[0]?.reason).toBe("pre-uninstall");
  });

  it("falls back to scripts/managed-app-install uninstall preview when hermes CLI is absent", async () => {
    await fs.mkdir(path.join(home, ".hermes"), { recursive: true });
    const job = await settle(await startUninstall("hermes", "hermes", true));
    expect(job.status).toBe("succeeded");
    expect(job.argv[0]).toMatch(/scripts\/managed-app-install$/);
    expect(job.argv.slice(1)).toEqual(["hermes", "uninstall", "--yes", "--dry-run"]);
  });
});
