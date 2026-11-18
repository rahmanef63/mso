// The version string must never hold the managed-apps list open. These pin the
// three properties that make that true: a known answer is served without forking
// again, concurrent callers share one probe, and the read itself never waits.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runner", () => ({
  runProgram: vi.fn(),
  resolveCommand: vi.fn(async () => "/home/someone/.local/bin/hermes"),
}));

const { runProgram, resolveCommand } = await import("./runner");
const { appVersion, probeAppVersion, forgetAppVersion, settledAppVersion } = await import("./app-version");
const { getManagedAppDefinition } = await import("./catalog");

const hermes = getManagedAppDefinition("hermes");
const probes = () => vi.mocked(runProgram).mock.calls.filter((call) => (call[1] as string[])[0] === "--version").length;

beforeEach(() => {
  vi.mocked(runProgram).mockReset();
  vi.mocked(runProgram).mockResolvedValue({ code: 0, stdout: "Hermes 1.0\n", stderr: "" });
  vi.mocked(resolveCommand).mockResolvedValue("/home/someone/.local/bin/hermes");
  forgetAppVersion("hermes");
});

afterEach(() => { vi.restoreAllMocks(); });

describe("managed app version probe", () => {
  it("probes by resolved path, never by bare name", async () => {
    await expect(probeAppVersion(hermes)).resolves.toBe("Hermes 1.0");
    const call = vi.mocked(runProgram).mock.calls.find((entry) => (entry[1] as string[])[0] === "--version");
    expect(call?.[0]).toBe("/home/someone/.local/bin/hermes");
  });

  it("caps the probe so a slow app cannot hold the response", async () => {
    // Hermes' real probe needs ~15 s. A cap that returns null in 4 s is correct;
    // a cap that waits 15 s is the bug this file fixes.
    vi.mocked(runProgram).mockResolvedValue({ code: 1, stdout: "", stderr: "timeout" });
    await expect(probeAppVersion(hermes)).resolves.toBeNull();
    const call = vi.mocked(runProgram).mock.calls.find((entry) => (entry[1] as string[])[0] === "--version");
    expect(call?.[2]).toBe(4_000);
  });

  it("shares one probe between concurrent callers", async () => {
    const answers = await Promise.all([probeAppVersion(hermes), probeAppVersion(hermes), probeAppVersion(hermes)]);
    expect(answers).toEqual(["Hermes 1.0", "Hermes 1.0", "Hermes 1.0"]);
    expect(probes()).toBe(1);
  });

  it("never waits on the read path", async () => {
    // First read has no cached value and still answers at once, so a caller that
    // builds a response list cannot be held by the probe.
    expect(appVersion(hermes)).toBeNull();
    // The read started the probe; awaiting the same probe does not start a second.
    await probeAppVersion(hermes);
    expect(probes()).toBe(1);
    expect(appVersion(hermes)).toBe("Hermes 1.0");
  });

  it("serves a known answer without forking again", async () => {
    await probeAppVersion(hermes);
    expect(appVersion(hermes)).toBe("Hermes 1.0");
    expect(appVersion(hermes)).toBe("Hermes 1.0");
    expect(probes()).toBe(1);
  });

  it("refreshes a stale answer in the background", async () => {
    await probeAppVersion(hermes);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 120_000));
      vi.mocked(runProgram).mockResolvedValue({ code: 0, stdout: "Hermes 2.0\n", stderr: "" });
      expect(appVersion(hermes)).toBe("Hermes 1.0"); // stale value, not a wait
      await vi.waitFor(() => expect(probes()).toBe(2));
      vi.useRealTimers();
      await expect(probeAppVersion(hermes)).resolves.toBe("Hermes 2.0");
      expect(appVersion(hermes)).toBe("Hermes 2.0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-probes after an install or restart clears the entry", async () => {
    await probeAppVersion(hermes);
    forgetAppVersion("hermes");
    expect(appVersion(hermes)).toBeNull();
    await probeAppVersion(hermes);
    expect(probes()).toBe(2);
  });

  it("settles for a reader of one app instead of reporting a cold cache as unknown", async () => {
    // The single-app route is the one place a wait is affordable: the caller already
    // waits for detection, and `version: null` there means "unknown" to both the
    // Details pane and `mso mapp show`.
    expect(appVersion(hermes)).toBeNull();
    await expect(settledAppVersion(hermes)).resolves.toBe("Hermes 1.0");
    expect(probes()).toBe(1);
    // A warm entry is served without forking again.
    await expect(settledAppVersion(hermes)).resolves.toBe("Hermes 1.0");
    expect(probes()).toBe(1);
  });
});
