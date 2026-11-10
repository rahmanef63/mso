// Program-runner level proofs. Docker is never started: every case injects the
// runner, and the assertions are about the ARGV that would have been spawned.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { screenshotDesktop, desktopLifecycle } = await import("./observer");

const ID = "a1b2c3d4e5f6";
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("rest-of-png"),
]);

/** `docker ps` output for one running bot box, as `{{json .}}` prints it. */
const PS_LINE = JSON.stringify({
  ID: `${ID}${"0".repeat(52)}`,
  Names: "grokbot-manef",
  State: "running",
  Status: "Up 4 minutes",
  CreatedAt: "2026-11-10 20:00:00 +0000 UTC",
  Ports: "127.0.0.1:6080->6080/tcp",
  Labels: {
    "grokbot.desktop": "1",
    "grokbot.user": "manef",
    "grokbot.bot": "b7",
    // Present in a real ps line, never allowed to leave the host.
    "com.example.token": "sk-live-should-not-leak",
  },
  Env: "SECRET_TOKEN=also-not-allowed",
});

function harness(overrides: { ps?: string; code?: number; stderr?: string; png?: Buffer } = {}) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run = vi.fn(async (command: string, args: readonly string[]) => {
    calls.push({ command, args: [...args] });
    return { code: overrides.code ?? 0, stdout: overrides.ps ?? PS_LINE, stderr: overrides.stderr ?? "" };
  });
  const runBytes = vi.fn(async (command: string, args: readonly string[]) => {
    calls.push({ command, args: [...args] });
    return { code: overrides.code ?? 0, stdout: overrides.png ?? PNG, stderr: overrides.stderr ?? "" };
  });
  return { calls, deps: { run, runBytes, hasDocker: async () => true } };
}

describe("screenshot argv is server-constructed", () => {
  it("execs the fixed tool with a rebuilt display and returns the PNG", async () => {
    const { calls, deps } = harness();
    const png = await screenshotDesktop(ID, "99", deps);
    expect(png.equals(PNG)).toBe(true);
    const exec = calls.find((call) => call.args[0] === "exec");
    expect(exec).toBeDefined();
    expect(exec!.command).toBe("docker");
    expect(exec!.args).toEqual(["exec", "grokbot-manef", "grokbot-shot", ":99"]);
  });

  it("uses the container name read back from inventory, never the caller's string", async () => {
    const { calls, deps } = harness();
    await screenshotDesktop(ID, "01", deps);
    const exec = calls.find((call) => call.args[0] === "exec");
    // The caller sent a 12-char id; docker receives the inventory name.
    expect(exec!.args).toEqual(["exec", "grokbot-manef", "grokbot-shot", ":01"]);
    expect(exec!.args.join(" ")).not.toContain(ID);
  });

  it("refuses a container that is not in our inventory before exec", async () => {
    const { calls, deps } = harness();
    await expect(screenshotDesktop("b" .repeat(12), "99", deps)).rejects.toMatchObject({ status: 404 });
    expect(calls.some((call) => call.args[0] === "exec")).toBe(false);
  });

  it("rejects an injection attempt without ever calling docker", async () => {
    const run = vi.fn();
    const runBytes = vi.fn();
    for (const hostile of ["abc; rm -rf /", "$(id)", "-v /:/host"]) {
      await expect(
        screenshotDesktop(hostile, "99", { run, runBytes, hasDocker: async () => true }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(run).not.toHaveBeenCalled();
    expect(runBytes).not.toHaveBeenCalled();
  });

  it("rejects a hostile screen value without ever calling docker", async () => {
    const run = vi.fn();
    const runBytes = vi.fn();
    for (const hostile of ["99; id", ":99 -window root", "$(id)"]) {
      await expect(
        screenshotDesktop(ID, hostile, { run, runBytes, hasDocker: async () => true }),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(runBytes).not.toHaveBeenCalled();
  });

  it("refuses a non-PNG producer instead of shipping its bytes as an image", async () => {
    const { deps } = harness({ png: Buffer.from("import: unable to open X display\n") });
    await expect(screenshotDesktop(ID, "99", deps)).rejects.toMatchObject({ status: 502 });
  });

  it("surfaces the producer's failure as a 502", async () => {
    const { deps } = harness({ code: 1, stderr: "refusing display arg: :77" });
    await expect(screenshotDesktop(ID, "77", deps)).rejects.toMatchObject({ status: 502 });
  });
});

describe("lifecycle is four verbs and nothing else", () => {
  it("spawns docker with the verb and the inventory name only", async () => {
    for (const action of ["start", "stop", "restart"] as const) {
      const { calls, deps } = harness();
      await desktopLifecycle(ID, action, { deps });
      const mutation = calls.find((call) => call.args[0] === action);
      expect(mutation, action).toBeDefined();
      expect(mutation!.args).toEqual([action, "grokbot-manef"]);
    }
  });

  it("returns the refreshed state after a lifecycle verb", async () => {
    const { deps } = harness();
    const result = await desktopLifecycle(ID, "restart", { deps });
    expect(result).toMatchObject({ action: "restart", container: "grokbot-manef" });
    expect(result.state).toMatchObject({ name: "grokbot-manef", state: "running" });
  });

  it("bounds logs and keeps them in one array", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const { calls, deps } = harness({ ps: "", stderr: "" });
    deps.run = vi.fn(async (command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      if (args[0] === "ps") return { code: 0, stdout: PS_LINE, stderr: "" };
      return { code: 0, stdout: lines, stderr: "" };
    });
    const result = await desktopLifecycle(ID, "logs", { lines: 5, deps });
    const logCall = calls.find((call) => call.args[0] === "logs");
    expect(logCall!.args).toEqual(["logs", "--tail", "5", "grokbot-manef"]);
    expect(result.logs).toHaveLength(5);
    expect(result.logs?.at(-1)).toBe("line 199");
  });

  it("clamps an oversized tail instead of honouring it", async () => {
    const { calls, deps } = harness({ ps: PS_LINE });
    deps.run = vi.fn(async (command: string, args: readonly string[]) => {
      calls.push({ command, args: [...args] });
      return args[0] === "ps"
        ? { code: 0, stdout: PS_LINE, stderr: "" }
        : { code: 0, stdout: "", stderr: "" };
    });
    await desktopLifecycle(ID, "logs", { lines: 100_000, deps });
    const logCall = calls.find((call) => call.args[0] === "logs");
    expect(logCall!.args[2]).toBe("500");
  });

  it("refuses an unknown container before mutating anything", async () => {
    const { calls, deps } = harness();
    await expect(desktopLifecycle("c".repeat(12), "stop", { deps })).rejects.toMatchObject({ status: 404 });
    expect(calls.some((call) => ["start", "stop", "restart", "logs"].includes(call.args[0]))).toBe(false);
  });

  it("rejects a container-injection attempt before mutating anything", async () => {
    const run = vi.fn();
    await expect(
      desktopLifecycle("abc; rm -rf /", "stop", { deps: { run, runBytes: vi.fn(), hasDocker: async () => true } }),
    ).rejects.toMatchObject({ status: 400 });
    expect(run).not.toHaveBeenCalled();
  });
});
