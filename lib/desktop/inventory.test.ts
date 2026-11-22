// Program-runner level proofs. Docker is never started: every case injects the
// runner, and the assertions are about the ARGV that would have been spawned.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { listDesktopContainers, parseContainerLine } = await import("./inventory");

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

describe("container inventory", () => {
  it("asks docker only for our label and only for the fields it needs", async () => {
    const { calls, deps } = harness();
    const containers = await listDesktopContainers(deps);
    expect(calls[0]).toEqual({
      command: "docker",
      args: ["ps", "-a", "--filter", "label=grokbot.desktop=1", "--format", "{{json .}}"],
    });
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({
      id: ID,
      name: "grokbot-manef",
      state: "running",
      status: "Up 4 minutes",
      created: "2026-11-10 20:00:00 +0000 UTC",
      ports: "127.0.0.1:6080->6080/tcp",
      labels: { user: "manef", bot: "b7" },
    });
  });

  it("serialises no env vars and no third-party labels", async () => {
    const { deps } = harness();
    const serialised = JSON.stringify(await listDesktopContainers(deps));
    expect(serialised).not.toContain("sk-live-should-not-leak");
    expect(serialised).not.toContain("SECRET_TOKEN");
    expect(serialised).not.toContain("com.example");
    // The whole label map is never echoed, only the two keys with a documented use.
    expect(serialised).not.toContain("grokbot.desktop");
  });

  it("fails closed when no docker client exists", async () => {
    const run = vi.fn();
    await expect(
      listDesktopContainers({ run, runBytes: vi.fn(), hasDocker: async () => false }),
    ).rejects.toMatchObject({ status: 503 });
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a docker failure instead of pretending the list is empty", async () => {
    const { deps } = harness({ code: 1, stderr: "Cannot connect to the Docker daemon" });
    await expect(listDesktopContainers(deps)).rejects.toMatchObject({ status: 502 });
  });
});

describe("parseContainerLine", () => {
  it("drops blank lines and rows with no id", () => {
    expect(parseContainerLine("")).toBeNull();
    expect(parseContainerLine("   ")).toBeNull();
    expect(parseContainerLine(JSON.stringify({ Names: "x" }))).toBeNull();
    expect(parseContainerLine("{not json")).toBeNull();
  });

  it("still reads the delimited format so an older docker degrades", () => {
    expect(parseContainerLine(`${ID}\tgrokbot-dita\trunning\tUp 1 minute\t6081/tcp`)).toMatchObject({
      id: ID,
      name: "grokbot-dita",
      state: "running",
      status: "Up 1 minute",
      ports: "6081/tcp",
    });
  });

  it("strips the leading slash docker puts on a name", () => {
    expect(parseContainerLine(JSON.stringify({ ID, Names: "/grokbot-lara" }))?.name).toBe("grokbot-lara");
  });
});

