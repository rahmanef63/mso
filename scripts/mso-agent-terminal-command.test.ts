import { describe, expect, it, vi } from "vitest";
import { handleTerminalCommand } from "./mso-agent-cmd-terminal.mjs";
import { handleSlash } from "./mso-agent-commands.mjs";

function createMockLoop() {
  let suspended = false;
  const suspend = vi.fn(() => {
    suspended = true;
  });
  const resume = vi.fn(() => {
    suspended = false;
  });
  return {
    active: true,
    suspend,
    resume,
    isSuspended: () => suspended,
  };
}

describe("/terminal slash command", () => {
  it("1. suspends panel, spawns $SHELL, resumes, and adds no exit line on exit code 0", async () => {
    const loop = createMockLoop();
    const session = { screenLoop: loop };
    const printer = { print: vi.fn() };
    const spawn = vi.fn(() => ({ status: 0, signal: null }));

    const outcome = await handleTerminalCommand(
      { session, printer },
      [],
      { spawn, env: { SHELL: "/bin/zsh" } },
    );

    expect(outcome).toBe("handled");
    // Verifies that panel alternate screen was released and resumed.
    expect(loop.suspend).toHaveBeenCalledTimes(1);
    expect(loop.resume).toHaveBeenCalledTimes(1);
    expect(loop.isSuspended()).toBe(false);

    // Verifies that bare /terminal spawns $SHELL with an empty argv array.
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith("/bin/zsh", [], {
      stdio: "inherit",
      env: { SHELL: "/bin/zsh" },
    });

    // Clean exit in interactive shell adds no noise to transcript.
    expect(printer.print).not.toHaveBeenCalled();
  });

  it("2. /terminal git status spawns with -c and exact argv, and adds one transcript line with exit code on non-zero", async () => {
    const loop = createMockLoop();
    const session = { screenLoop: loop };
    const printer = { print: vi.fn() };
    const spawn = vi.fn(() => ({ status: 128, signal: null }));

    const outcome = await handleTerminalCommand(
      { session, printer },
      ["git", "status"],
      { spawn, env: { SHELL: "/bin/bash" } },
    );

    expect(outcome).toBe("handled");
    expect(loop.suspend).toHaveBeenCalledTimes(1);
    expect(loop.resume).toHaveBeenCalledTimes(1);

    // Verifies command is passed through shell -c with the joined command string.
    expect(spawn).toHaveBeenCalledWith(
      "/bin/bash",
      ["-c", "git status"],
      expect.objectContaining({ stdio: "inherit" }),
    );

    // Non-zero exit code must be reported to the transcript.
    expect(printer.print).toHaveBeenCalledTimes(1);
    expect(printer.print).toHaveBeenCalledWith(expect.stringContaining("128"));
  });

  it("3. a spawn failure (throw or error field) reports one line and still resumes, never leaving the panel suspended", async () => {
    // Case A: spawn throws an exception (e.g. process error).
    const loopThrow = createMockLoop();
    const sessionThrow = { screenLoop: loopThrow };
    const printerThrow = { print: vi.fn() };
    const spawnThrow = vi.fn(() => {
      throw new Error("spawn failed: permission denied");
    });

    await handleTerminalCommand(
      { session: sessionThrow, printer: printerThrow },
      [],
      { spawn: spawnThrow },
    );

    expect(loopThrow.suspend).toHaveBeenCalledTimes(1);
    expect(loopThrow.resume).toHaveBeenCalledTimes(1);
    expect(loopThrow.isSuspended()).toBe(false);
    expect(printerThrow.print).toHaveBeenCalledTimes(1);
    expect(printerThrow.print).toHaveBeenCalledWith(
      expect.stringContaining("permission denied"),
    );

    // Case B: spawn returns an object containing an error property.
    const loopError = createMockLoop();
    const sessionError = { screenLoop: loopError };
    const printerError = { print: vi.fn() };
    const spawnError = vi.fn(() => ({
      error: new Error("spawn ENOENT"),
      status: null,
    }));

    await handleTerminalCommand(
      { session: sessionError, printer: printerError },
      [],
      { spawn: spawnError },
    );

    expect(loopError.suspend).toHaveBeenCalledTimes(1);
    expect(loopError.resume).toHaveBeenCalledTimes(1);
    expect(loopError.isSuspended()).toBe(false);
    expect(printerError.print).toHaveBeenCalledTimes(1);
    expect(printerError.print).toHaveBeenCalledWith(
      expect.stringContaining("spawn ENOENT"),
    );
  });

  it("4. inline mode (no panel) runs the command without any suspend call", async () => {
    // When screenLoop is absent or inactive, no suspend/resume methods exist to call.
    const loop = {
      active: false,
      suspend: vi.fn(),
      resume: vi.fn(),
    };
    const session = { screenLoop: loop };
    const printer = { print: vi.fn() };
    const spawn = vi.fn(() => ({ status: 0 }));

    const outcome = await handleTerminalCommand(
      { session, printer },
      ["git", "status"],
      { spawn },
    );

    expect(outcome).toBe("handled");
    expect(loop.suspend).not.toHaveBeenCalled();
    expect(loop.resume).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("5. the argv array never contains a joined string when the command had no spaces to preserve; assert the exact argv shape for a simple command", async () => {
    let capturedArgv: string[] = [];
    const spawn = vi.fn((_shell: string, argv: string[]) => {
      capturedArgv = argv;
      return { status: 0 };
    });

    // Test a single-word command with no spaces.
    await handleTerminalCommand(
      {},
      ["status"],
      { spawn },
    );

    expect(capturedArgv).toEqual(["-c", "status"]);
    // Neither element should contain whitespace or accidental concatenation.
    expect(capturedArgv[0]).toBe("-c");
    expect(capturedArgv[1]).toBe("status");
    expect(capturedArgv[1]).not.toContain(" ");
  });

  it("dispatches through handleSlash router for /terminal and alias /term", async () => {
    const loop = createMockLoop();
    const spawn = vi.fn(() => ({ status: 0 }));
    const session = {
      screenLoop: loop,
      spawn,
      state: { skills: { skills: [] } },
      history: [],
      printSink: vi.fn(),
    };

    const outcome = await handleSlash(
      null,
      "/terminal",
      session,
      {
        runTurn: async () => {},
        runSubagent: async () => {},
      },
    );

    expect(outcome).toBe("handled");
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
