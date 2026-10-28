import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleSlash } from "./mso-agent-commands.mjs";
import { handleParityCommand } from "./mso-agent-cmd-parity.mjs";
import { handleInspectCommand } from "./mso-agent-cmd-inspect.mjs";
import { handleSessionCommand } from "./mso-agent-cmd-session.mjs";

const EXPECTED_COMMANDS = [
  "clear",
  "compact",
  "context",
  "diff",
  "doctor",
  "exit",
  "export",
  "files",
  "help",
  "image",
  "integrations",
  "model",
  "models",
  "new",
  "permission",
  "provider",
  "providers",
  "queue",
  "quit",
  "reasoning",
  "rename",
  "restart",
  "resume",
  "session",
  "sessions",
  "setup",
  "share",
  "skill",
  "skills",
  "stash",
  "status",
  "statusbar",
  "theme",
  "title",
  "tools",
];

describe("MSO Agent slash commands module split", () => {
  it("preserves every command arm from before the split across all four files", () => {
    const files = [
      path.join(__dirname, "mso-agent-commands.mjs"),
      path.join(__dirname, "mso-agent-cmd-parity.mjs"),
      path.join(__dirname, "mso-agent-cmd-inspect.mjs"),
      path.join(__dirname, "mso-agent-cmd-session.mjs"),
    ];

    const arms = new Set<string>();
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const matches = source.matchAll(/case\s+"\/([a-z]+)"/g);
      for (const m of matches) {
        arms.add(m[1]);
      }
    }

    expect([...arms].sort()).toEqual([...EXPECTED_COMMANDS].sort());
  });

  it("returns null from sub-routers when command is unknown", async () => {
    const dummyCtx = {
      rl: null,
      session: { state: { tools: [], skills: { skills: [] } }, history: [] },
      runTurn: vi.fn(),
      runSubagent: vi.fn(),
      runCli: vi.fn(),
      api: vi.fn(),
      state: vi.fn(),
      C: {},
    };

    expect(await handleParityCommand(dummyCtx, "/unknown", [])).toBeNull();
    expect(await handleInspectCommand(dummyCtx, "/unknown", [])).toBeNull();
    expect(await handleSessionCommand(dummyCtx, "/unknown", [])).toBeNull();
  });

  it("falls through to slash skill selection for unknown slash commands", async () => {
    const session = {
      state: { skills: { skills: [] } },
      history: [],
      agentSession: { id: "test-session" },
    };
    const outcome = await handleSlash(null, "/unknown-cmd", session, {
      runTurn: async () => {},
      runSubagent: async () => {},
    });
    expect(outcome).toBe("unknown");
  });

  it("handles known commands in extracted routers correctly", async () => {
    const session = {
      state: { tools: [], skills: { skills: [] } },
      history: [],
      agentSession: { id: "test-session" },
    };
    const runCli = vi.fn().mockReturnValue(0);
    const ctx = {
      rl: null,
      session,
      runTurn: vi.fn(),
      runSubagent: vi.fn(),
      runCli,
      api: vi.fn(),
      state: vi.fn(),
      C: {},
    };

    expect(await handleSessionCommand(ctx, "/restart", [])).toBe("restart");
    expect(await handleSessionCommand(ctx, "/exit", [])).toBe("exit");
    expect(await handleParityCommand(ctx, "/share", [])).toBe("handled");
    expect(await handleInspectCommand(ctx, "/doctor", [])).toBe("handled");
    expect(runCli).toHaveBeenCalledWith(["doctor"]);
  });
});
