import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeRestartUiState, relaunchAgentSession } from "./mso-agent-lifecycle.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.MSO_AGENT_RESTART_PERMISSION;
  delete process.env.MSO_AGENT_RESTART_STATUSBAR;
});

describe("MSO Agent soft restart", () => {
  it("relaunches the same durable session in the same inherited terminal", () => {
    const calls: unknown[][] = [];
    const execve = (...args: unknown[]) => {
      calls.push(args);
      throw new Error("execve sentinel");
    };
    expect(() => relaunchAgentSession(
      {
        cli: "/opt/mso/bin/mso",
        sessionId: "sess_same_123",
        permission: "auto",
        statusBar: false,
      },
      execve as never,
    )).toThrow(/execve sentinel/);
    expect(calls).toHaveLength(1);
    const [command, args, env] = calls[0] as [string, string[], NodeJS.ProcessEnv];
    expect(command).toBe("/opt/mso/bin/mso");
    expect(args).toEqual(["/opt/mso/bin/mso", "agent", "--restart-session", "sess_same_123"]);
    expect(env.MSO_AGENT_RESTART_PERMISSION).toBe("auto");
    expect(env.MSO_AGENT_RESTART_STATUSBAR).toBe("off");
  });

  it("consumes restart-only UI state so it does not leak into later child processes", () => {
    process.env.MSO_AGENT_RESTART_PERMISSION = "yolo";
    process.env.MSO_AGENT_RESTART_STATUSBAR = "on";
    expect(consumeRestartUiState()).toEqual({ permission: "yolo", statusBar: true });
    expect(process.env.MSO_AGENT_RESTART_PERMISSION).toBeUndefined();
    expect(process.env.MSO_AGENT_RESTART_STATUSBAR).toBeUndefined();
  });

  it("fails closed when no durable session id exists", () => {
    expect(() =>
      relaunchAgentSession({ cli: "mso", sessionId: "" }, (() => undefined) as never),
    ).toThrow(/durable session id/);
  });

  it("fails closed rather than falling back to a nesting child process", () => {
    expect(() =>
      relaunchAgentSession({ cli: "mso", sessionId: "sess_1" }, null as never),
    ).toThrow(/cannot replace the Agent process safely/);
  });
});
