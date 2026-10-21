import { beforeEach, describe, expect, it, vi } from "vitest";

// The acceptance rule this file exists for: enabling writes the pref AND installs the
// timer; disabling removes the timer BEFORE the pref says "off"; a host that cannot
// host a timer is refused instead of storing an intent nobody will execute.
const mocks = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  reason: null as string | null,
  written: [] as unknown[],
  install: vi.fn(),
  remove: vi.fn(),
  timer: { installed: true, enabled: true, active: true, nextRun: null as string | null },
}));
vi.mock("../prefs/store", () => ({
  readPrefs: async () => ({ updates: mocks.stored }),
  writePrefs: async (patch: unknown) => { mocks.written.push(patch); return {}; },
}));
vi.mock("../prefs/auto-update-state", () => ({
  readAutoUpdateState: async () => ({ lastAttemptAt: null, lastResult: null, consecutiveFailures: 0, detail: null, channel: null }),
}));
vi.mock("./update-host-support", () => ({
  automaticUpdateReason: async () => mocks.reason,
  execRunner: async () => ({ code: 0, stdout: "", stderr: "" }),
  updateLogPath: () => "/tmp/self-update.log",
}));
vi.mock("./self-update-timer", () => ({
  readTimerState: async () => mocks.timer,
  realTimerIo: () => ({}),
  installTimer: (...args: unknown[]) => mocks.install(...args),
  removeTimer: (...args: unknown[]) => mocks.remove(...args),
}));

const { applyAutomation, readAutomationState } = await import("./update-automation");
const ctx = { root: "/srv/mso" };

beforeEach(() => {
  mocks.stored = {};
  mocks.reason = null;
  mocks.written = [];
  mocks.timer = { installed: true, enabled: true, active: true, nextRun: null };
  mocks.install.mockReset().mockResolvedValue({ ok: true });
  mocks.remove.mockReset().mockResolvedValue({ ok: true });
});

describe("update automation authority", () => {
  it("installs the timer and stores the pref when the owner enables it", async () => {
    mocks.timer = { installed: false, enabled: false, active: false, nextRun: null };
    await applyAutomation({ auto: true }, ctx);
    expect(mocks.install).toHaveBeenCalledWith("/srv/mso", "/tmp/self-update.log", expect.anything());
    expect(mocks.written).toEqual([{ updates: { auto: true, channel: "main" } }]);
  });

  it("removes the timer when the owner disables it", async () => {
    mocks.stored = { auto: true, channel: "main" };
    await applyAutomation({ auto: false }, ctx);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.written).toEqual([{ updates: { auto: false, channel: "main" } }]);
  });

  it("refuses to store auto:true on a host with no safe restart path", async () => {
    mocks.reason = "mso.service has no automatic restart policy; refusing to stop the running process during self-update";
    await expect(applyAutomation({ auto: true }, ctx)).rejects.toThrow(/no automatic restart policy/);
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.written).toEqual([]);
  });

  it("does not store auto:true when the timer could not be enabled", async () => {
    mocks.install.mockResolvedValue({ ok: false, error: "could not enable the update timer: permission denied" });
    await expect(applyAutomation({ auto: true }, ctx)).rejects.toThrow(/permission denied/);
    expect(mocks.written).toEqual([]);
  });

  it("changes only the channel without touching the timer", async () => {
    mocks.stored = { auto: false, channel: "stable" };
    await applyAutomation({ channel: "main" }, ctx);
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.written).toEqual([{ updates: { auto: false, channel: "main" } }]);
  });

  it("reports 'active' only when the pref and the real unit agree, and names the drift", async () => {
    mocks.stored = { auto: true, channel: "stable" };
    mocks.timer = { installed: false, enabled: false, active: false, nextRun: null };
    const state = await readAutomationState();
    expect(state.active).toBe(false);
    expect(state.drift).toContain("timer is missing");

    mocks.timer = { installed: true, enabled: true, active: true, nextRun: null };
    expect((await readAutomationState()).active).toBe(true);

    mocks.stored = { auto: false, channel: "stable" };
    const leftover = await readAutomationState();
    expect(leftover.active).toBe(false);
    expect(leftover.drift).toContain("still scheduled");
  });
});
