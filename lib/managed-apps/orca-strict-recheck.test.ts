import { beforeEach, describe, expect, it, vi } from "vitest";

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
type OrcaInstallationModule = typeof import("./orca-installation");

vi.mock("./orca-installation", async (importOriginal) => {
  const actual = (await importOriginal()) as OrcaInstallationModule;
  return {
    ...actual,
    detectOrca: vi.fn(),
  };
});

const { runProgram } = await import("./runner");
const { detectOrca } = await import("./orca-installation");
const { assertManagedAppStopped, getManagedApp } = await import("./manager");

describe("assertManagedAppStopped strict Orca recheck", () => {
  beforeEach(() => {
    vi.mocked(runProgram).mockReset();
    vi.mocked(detectOrca).mockReset();
  });

  it("passes when Orca is owned and systemd confirms it is stopped", async () => {
    vi.mocked(detectOrca).mockResolvedValue({
      type: "systemd",
      serviceName: "mso-orca.service",
      serviceNames: ["mso-orca.service"],
      owned: true,
    });
    vi.mocked(runProgram).mockImplementation(async (cmd: string, args: readonly string[]) => {
      if (cmd === "systemctl" && args.includes("show")) {
        return { code: 0, stdout: "LoadState=loaded\nActiveState=inactive\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await expect(assertManagedAppStopped("orca")).resolves.toBeUndefined();
  });

  it("fails when Orca is not installed with a reinstall-required diagnostic", async () => {
    const diag =
      "mso-orca.service was installed by an older MSO release that did not record its launcher identity; reinstall Orca with this MSO version to manage it.";
    vi.mocked(detectOrca).mockResolvedValue({
      type: "not-installed",
      diagnostic: diag,
    });

    await expect(assertManagedAppStopped("orca")).rejects.toThrow(/reinstall Orca with this MSO version/);
  });

  it("fails closed when Orca has not-installed without diagnostic", async () => {
    vi.mocked(detectOrca).mockResolvedValue({
      type: "not-installed",
      diagnostic: null,
    });

    await expect(assertManagedAppStopped("orca")).rejects.toThrow(/install state cannot prove absence/);
  });
});

describe("an owned Orca reports the version its receipt already proved", () => {
  beforeEach(() => {
    vi.mocked(runProgram).mockReset();
    vi.mocked(detectOrca).mockReset();
    vi.mocked(detectOrca).mockResolvedValue({
      type: "systemd",
      serviceName: "mso-orca.service",
      serviceNames: ["mso-orca.service"],
      owned: true,
      version: "1.4.230",
    });
    // Detection verified the release; nothing here may fork the adapter again.
    vi.mocked(runProgram).mockImplementation(async (cmd: string, args: readonly string[]) => {
      if (cmd === "systemctl" && args.includes("show")) {
        return { code: 0, stdout: "LoadState=loaded\nActiveState=active\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
  });

  it("uses the proven version instead of re-probing with --version", async () => {
    // The display probe caps at 4 s; Orca's own --version rehash needs about 8 s here,
    // so a second fork can only ever answer null and the pane showed "unknown".
    const app = await getManagedApp("orca", { settledVersion: true });
    expect(app.version).toBe("1.4.230");
    const forked = vi.mocked(runProgram).mock.calls.filter((call) => (call[1] as string[])[0] === "--version");
    expect(forked).toEqual([]);
  });
});
