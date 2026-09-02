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
    const runner = (...args: unknown[]) => {
      calls.push(args);
      return { status: 0 };
    };
    const status = relaunchAgentSession(
      {
        cli: "/opt/mso/bin/mso",
        sessionId: "sess_same_123",
        permission: "auto",
        statusBar: false,
      },
      runner as never,
    );
    expect(status).toBe(0);
    expect(calls).toHaveLength(1);
    const [command, args, options] = calls[0] as [string, string[], { stdio: string; env: NodeJS.ProcessEnv }];
    expect(command).toBe("/opt/mso/bin/mso");
    expect(args).toEqual(["agent", "--resume", "sess_same_123"]);
    expect(options.stdio).toBe("inherit");
    expect(options.env.MSO_AGENT_RESTART_PERMISSION).toBe("auto");
    expect(options.env.MSO_AGENT_RESTART_STATUSBAR).toBe("off");
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
      relaunchAgentSession({ cli: "mso", sessionId: "" }, (() => ({ status: 0 })) as never),
    ).toThrow(/durable session id/);
  });
});
