import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/managed-apps/runner", () => ({ runProgram: vi.fn() }));

import { runProgram } from "@/lib/managed-apps/runner";
import { camoufoxStatus, parseUnitShow, setCamoufoxEnabled, terminateCamoufoxSessions } from "./service";

const mockRun = vi.mocked(runProgram);

const show = (props: Record<string, string>) =>
  Object.entries(props)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });

const RUNNING = show({ LoadState: "loaded", ActiveState: "active", UnitFileState: "enabled" });
const OFF = show({ LoadState: "loaded", ActiveState: "inactive", UnitFileState: "disabled" });
// The steady state after a UI "on": powered up, and STILL not armed for boot.
const ON = show({ LoadState: "loaded", ActiveState: "active", UnitFileState: "disabled" });

beforeEach(() => {
  mockRun.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("camoufox unit status parsing", () => {
  it("reads a running, boot-persistent unit", () => {
    expect(parseUnitShow(RUNNING)).toEqual({ installed: true, running: true, enabled: true });
  });

  it("separates 'stopped' from 'will not come back'", () => {
    // What `disable --now` leaves behind: down now AND down after a reboot.
    expect(parseUnitShow(OFF)).toEqual({ installed: true, running: false, enabled: false });
    // Stopped but still armed for boot — what the retired `enable --now` toggle left
    // behind, and now reachable only by someone running `systemctl --user enable` by
    // hand. The parse still has to tell it apart from a real off.
    expect(
      parseUnitShow(show({ LoadState: "loaded", ActiveState: "inactive", UnitFileState: "enabled" })),
    ).toEqual({ installed: true, running: false, enabled: true });
  });

  it("treats a missing unit as not installed, not merely stopped", () => {
    // systemd answers for an unknown unit with rc 0 and ActiveState=inactive, so
    // ActiveState alone cannot tell the two apart — LoadState is the discriminator.
    expect(
      parseUnitShow(show({ LoadState: "not-found", ActiveState: "inactive", UnitFileState: "" })),
    ).toEqual({ installed: false, running: false, enabled: false });
    expect(parseUnitShow("")).toEqual({ installed: false, running: false, enabled: false });
  });

  it("counts the non-'enabled' states that still come back after a reboot", () => {
    for (const state of ["enabled-runtime", "static", "linked", "generated", "indirect"]) {
      expect(parseUnitShow(show({ LoadState: "loaded", ActiveState: "active", UnitFileState: state })).enabled).toBe(true);
    }
    for (const state of ["disabled", "masked"]) {
      expect(parseUnitShow(show({ LoadState: "loaded", ActiveState: "active", UnitFileState: state })).enabled).toBe(false);
    }
  });
});

describe("camoufox lifecycle", () => {
  it("queries the user bus, never the system one", async () => {
    mockRun.mockResolvedValue(ok(RUNNING));
    await camoufoxStatus();
    const args = mockRun.mock.calls[0]![1] as string[];
    expect(mockRun.mock.calls[0]![0]).toBe("systemctl");
    expect(args[0]).toBe("--user");
    expect(args).toContain("camoufox-vnc.service");
  });

  it("does not disguise an unreachable user bus as 'not installed'", async () => {
    // The exact prod failure this guards: a system unit running as the user gets no
    // XDG_RUNTIME_DIR, systemctl exits non-zero, and reporting `installed:false`
    // would tell the operator to install something that is already there.
    mockRun.mockResolvedValue({ code: 1, stdout: "", stderr: "Failed to connect to bus: No medium found" });
    await expect(camoufoxStatus()).rejects.toThrow(/No medium found/);
  });

  it("reports viewer readiness only after the loopback document answers", async () => {
    mockRun.mockResolvedValue(ok(RUNNING));
    await expect(camoufoxStatus()).resolves.toMatchObject({ running: true, viewerReady: true });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("not listening"); }));
    await expect(camoufoxStatus()).resolves.toMatchObject({ running: true, viewerReady: false });
  });

  it("never probes an off-box noVNC URL from configuration", async () => {
    vi.stubEnv("CAMOUFOX_NOVNC_URL", "https://evil.example/vnc.html");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockRun.mockResolvedValue(ok(RUNNING));
    await expect(camoufoxStatus()).resolves.toMatchObject({ viewerReady: false });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("powers the session without ever re-arming boot autostart", async () => {
    // The bug this guards: `enable --now` made every "Turn on" click re-create
    // default.target.wants, so the browser came back at every boot and sat there for a
    // day at a time. Powering on must leave `enabled` false.
    mockRun.mockResolvedValueOnce(ok(OFF)).mockResolvedValueOnce(ok("")).mockResolvedValueOnce(ok(ON));
    expect(await setCamoufoxEnabled(true)).toEqual({ installed: true, running: true, enabled: false });
    expect(mockRun.mock.calls[1]![1]).toEqual(["--user", "start", "camoufox-vnc.service"]);

    mockRun.mockReset();
    mockRun.mockResolvedValueOnce(ok(ON)).mockResolvedValueOnce(ok("")).mockResolvedValueOnce(ok(OFF));
    expect(await setCamoufoxEnabled(false)).toEqual({ installed: true, running: false, enabled: false });
    expect(mockRun.mock.calls[1]![1]).toEqual(["--user", "stop", "camoufox-vnc.service"]);
  });

  it("refuses to act on a host where the unit does not exist", async () => {
    mockRun.mockResolvedValue(ok(show({ LoadState: "not-found", ActiveState: "inactive" })));
    await expect(setCamoufoxEnabled(true)).rejects.toThrow(/not installed/);
    expect(mockRun).toHaveBeenCalledTimes(1); // never reached the start
  });

  it("surfaces a failed systemctl instead of reporting success", async () => {
    mockRun.mockResolvedValueOnce(ok(OFF)).mockResolvedValueOnce({ code: 5, stdout: "", stderr: "boom" });
    await expect(setCamoufoxEnabled(true)).rejects.toThrow(/rc 5/);
  });
  it("tears down a running viewer and verifies that the unit is inactive", async () => {
    mockRun.mockResolvedValueOnce(ok(ON)).mockResolvedValueOnce(ok("")).mockResolvedValueOnce(ok(OFF));
    await expect(terminateCamoufoxSessions()).resolves.toBeUndefined();
    expect(mockRun.mock.calls[1]![1]).toEqual(["--user", "stop", "camoufox-vnc.service"]);
  });

  it("does nothing when no viewer process exists", async () => {
    mockRun.mockResolvedValueOnce(ok(OFF));
    await expect(terminateCamoufoxSessions()).resolves.toBeUndefined();
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("falls back to killing the service cgroup when graceful stop fails", async () => {
    mockRun
      .mockResolvedValueOnce(ok(ON))
      .mockResolvedValueOnce({ code: 5, stdout: "", stderr: "stop failed" })
      .mockResolvedValueOnce(ok(""))
      .mockResolvedValueOnce(ok(OFF));
    await expect(terminateCamoufoxSessions()).resolves.toBeUndefined();
    expect(mockRun.mock.calls[2]![1]).toEqual([
      "--user", "kill", "--kill-who=all", "--signal=SIGKILL", "camoufox-vnc.service",
    ]);
  });

  it("fails closed when neither stop nor cgroup kill succeeds", async () => {
    mockRun
      .mockResolvedValueOnce(ok(ON))
      .mockResolvedValueOnce({ code: 5, stdout: "", stderr: "stop failed" })
      .mockResolvedValueOnce({ code: 6, stdout: "", stderr: "kill failed" });
    await expect(terminateCamoufoxSessions()).rejects.toThrow(/stop rc 5, kill rc 6/);
  });

});
