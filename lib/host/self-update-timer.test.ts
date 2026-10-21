import { describe, expect, it } from "vitest";
import { installTimer, readTimerState, removeTimer, unitFiles, unitPaths, type TimerMutation } from "./self-update-timer";
import type { Ran, Runner } from "./update-host-support";

function io(over: Partial<TimerMutation> & { calls?: string[][] } = {}): TimerMutation {
  const calls = over.calls ?? [];
  const run: Runner = async (command, args) => {
    calls.push([command, ...args]);
    return { code: 0, stdout: "", stderr: "" } as Ran;
  };
  return {
    run: over.run ?? run,
    writeFile: over.writeFile ?? (async () => undefined),
    removeFile: over.removeFile ?? (async () => undefined),
    mkdir: over.mkdir ?? (async () => undefined),
  };
}

describe("nightly update timer units", () => {
  it("schedules a jittered, persistent nightly run of the fixed entry point", () => {
    const files = unitFiles("/srv/mso", "/home/alice/.mso/self-update.log");
    expect(files.timer).toContain("OnCalendar=*-*-* 04:30:00");
    expect(files.timer).toContain("RandomizedDelaySec=25m");
    expect(files.timer).toContain("Persistent=true");
    expect(files.timer).toContain("Unit=mso-auto-update.service");
    expect(files.service).toContain("Type=oneshot");
    expect(files.service).toContain('WorkingDirectory="/srv/mso"');
    expect(files.service).toContain('/srv/mso/scripts/mso-auto-update');
    // No unit argument: the channel comes from prefs at run time, not from a file a
    // client could have influenced.
    expect(files.service).not.toContain("--channel");
  });

  it("quotes a checkout path with spaces instead of splitting it into two argv", () => {
    const files = unitFiles("/srv/my mso", "/tmp/a b.log");
    expect(files.service).toContain('WorkingDirectory="/srv/my mso"');
    expect(files.service).toContain('MSO_UPDATE_LOG="/tmp/a b.log"');
  });

  it("never reports the timer as installed when the manager does not know it", async () => {
    const unknown = await readTimerState(async () => ({ code: 1, stdout: "", stderr: "not found" }));
    expect(unknown).toEqual({ installed: false, enabled: false, active: false, nextRun: null });
    // systemd answers `n/a` for a loaded-but-unscheduled timer: that is not a date.
    const loaded = await readTimerState(async (_command, args) => {
      if (args.includes("LoadState")) return { code: 0, stdout: "loaded\n", stderr: "" };
      if (args.includes("is-enabled")) return { code: 0, stdout: "enabled\n", stderr: "" };
      if (args.includes("is-active")) return { code: 0, stdout: "active\n", stderr: "" };
      return { code: 0, stdout: "n/a\n", stderr: "" };
    });
    expect(loaded).toMatchObject({ installed: true, enabled: true, active: true, nextRun: null });
  });

  it("enables the timer after writing both units, and surfaces a refusal", async () => {
    const calls: string[][] = [];
    const written: string[] = [];
    const result = await installTimer("/srv/mso", "/tmp/log", io({
      calls,
      writeFile: async (file) => { written.push(file); },
    }));
    expect(result).toEqual({ ok: true });
    expect(written.map((f) => f.split("/").pop())).toEqual(["mso-auto-update.service", "mso-auto-update.timer"]);
    expect(calls.map((c) => c.join(" "))).toContain("systemctl --user daemon-reload");
    expect(calls.map((c) => c.join(" ")).some((c) => c.includes("enable --now mso-auto-update.timer"))).toBe(true);
  });

  it("reports a failed enable instead of pretending the pref is enough", async () => {
    const result = await installTimer("/srv/mso", "/tmp/log", io({
      run: async (_command, args) =>
        args.includes("enable") ? { code: 1, stdout: "", stderr: "permission denied" } : { code: 0, stdout: "", stderr: "" },
    }));
    expect(result).toEqual({ ok: false, error: "could not enable the update timer: permission denied" });
  });

  it("disables and deletes both units, tolerating units that were never installed", async () => {
    const calls: string[][] = [];
    const removed: string[] = [];
    expect(await removeTimer(io({
      calls,
      removeFile: async (file) => { removed.push(file.split("/").pop() ?? file); },
    }))).toEqual({ ok: true });
    expect(removed).toEqual(["mso-auto-update.timer", "mso-auto-update.service"]);
    const flat = calls.map((c) => c.join(" "));
    expect(flat.some((c) => c.includes("disable --now mso-auto-update.timer"))).toBe(true);
  });

  it("places units beside the user's other MSO units", () => {
    const previous = process.env.MSO_SYSTEMD_USER_DIR;
    process.env.MSO_SYSTEMD_USER_DIR = "/tmp/units";
    try {
      expect(unitPaths()).toEqual({
        service: "/tmp/units/mso-auto-update.service",
        timer: "/tmp/units/mso-auto-update.timer",
      });
    } finally {
      if (previous === undefined) delete process.env.MSO_SYSTEMD_USER_DIR;
      else process.env.MSO_SYSTEMD_USER_DIR = previous;
    }
  });
});
