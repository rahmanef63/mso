import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runner", () => ({
  commandExists: vi.fn(),
  runProgram: vi.fn(),
}));

const { commandExists, runProgram } = await import("./runner");
const { dockerUsable, runDocker } = await import("./docker");
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "denied") => ({ code: 1, stdout: "", stderr });

beforeEach(() => {
  vi.mocked(commandExists).mockReset().mockResolvedValue(true);
  vi.mocked(runProgram).mockReset();
});

describe("managed-app Docker runtime", () => {
  it("uses bare Docker when the service user can reach the daemon", async () => {
    vi.mocked(runProgram).mockResolvedValue(ok("27.0"));
    await expect(dockerUsable()).resolves.toBe(true);
    await runDocker(["ps", "-a"]);
    expect(vi.mocked(runProgram).mock.calls.some(([cmd, args]) => cmd === "docker" && args[0] === "ps")).toBe(true);
    expect(vi.mocked(runProgram).mock.calls.some(([cmd]) => cmd === "sudo")).toBe(false);
  });

  it("falls back to passwordless sudo without putting a shell in the path", async () => {
    vi.mocked(runProgram).mockImplementation(async (cmd, args) => {
      if (cmd === "docker" && args[0] === "version") return fail("permission denied");
      if (cmd === "sudo" && args[0] === "-n" && args[1] === "docker") return ok("27.0");
      return fail("unexpected");
    });
    await expect(dockerUsable()).resolves.toBe(true);
    const result = await runDocker(["ps", "-a", "--format", "{{.Names}}"]);
    expect(result.code).toBe(0);
    expect(vi.mocked(runProgram).mock.calls.some(([cmd, args]) =>
      cmd === "sudo" && args.slice(0, 3).join(" ") === "-n docker ps",
    )).toBe(true);
  });

  it("fails closed when neither direct nor sudo Docker can reach the daemon", async () => {
    vi.mocked(runProgram).mockResolvedValue(fail());
    await expect(dockerUsable()).resolves.toBe(false);
    await expect(runDocker(["ps"])).resolves.toMatchObject({ code: 127 });
  });
});
