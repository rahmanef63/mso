import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node-pty";
import { PTY_TOOLS } from "./tools-pty";

let canSpawn = false;
try {
  const p = spawn(process.platform === "win32" ? "cmd.exe" : "/bin/sh", [], { cols: 80, rows: 24 });
  p.kill();
  canSpawn = true;
} catch {
  canSpawn = false;
}

const tool = PTY_TOOLS[0];
const contextA = { principal: "mcp-client:pty-tester-a", scope: "exec" as const };
const contextB = { principal: "mcp-client:pty-tester-b", scope: "exec" as const };
const openedSessions: string[] = [];

async function pollRead(
  sessionId: string,
  context: typeof contextA,
  predicate: (out: string) => boolean,
  sinceOffset = 0,
  timeoutMs = 4000,
) {
  const start = Date.now();
  let res = (await tool.run({ action: "read", sessionId, since_offset: sinceOffset }, context)) as {
    output: string;
    nextOffset: number;
    truncated: boolean;
    promptSuspected?: boolean;
    exited?: boolean;
    exitCode?: number;
  };
  while (!predicate(res.output) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 60));
    res = (await tool.run({ action: "read", sessionId, since_offset: sinceOffset }, context)) as typeof res;
  }
  return res;
}

afterAll(async () => {
  for (const id of openedSessions) {
    try {
      await tool.run({ action: "close", sessionId: id }, contextA);
    } catch {
      // ignore
    }
  }
});

describe("pty_session tool", () => {
  it.skipIf(!canSpawn)(
    "1. open returns session id, write echoes into read output, nextOffset advances",
    async () => {
      const opened = (await tool.run({ action: "open" }, contextA)) as {
        sessionId: string;
        cols: number;
        rows: number;
      };
      expect(opened.sessionId).toBeDefined();
      expect(opened.cols).toBe(120);
      expect(opened.rows).toBe(30);
      openedSessions.push(opened.sessionId);

      const writeRes = (await tool.run(
        { action: "write", sessionId: opened.sessionId, data: "echo PTY_TEST_123\n" },
        contextA,
      )) as { ok: boolean; bytesWritten: number };
      expect(writeRes.ok).toBe(true);
      expect(writeRes.bytesWritten).toBeGreaterThan(0);

      const readRes = await pollRead(opened.sessionId, contextA, (o) => o.includes("PTY_TEST_123"));
      expect(readRes.output).toContain("PTY_TEST_123");
      expect(readRes.nextOffset).toBeGreaterThan(0);
    },
  );

  it.skipIf(!canSpawn)("2. second read with since_offset does not repeat earlier bytes", async () => {
    const opened = (await tool.run({ action: "open" }, contextA)) as { sessionId: string };
    openedSessions.push(opened.sessionId);

    await tool.run({ action: "write", sessionId: opened.sessionId, data: "echo ECHO_ONCE_A\n" }, contextA);
    const read1 = await pollRead(opened.sessionId, contextA, (o) => o.includes("ECHO_ONCE_A"));
    expect(read1.output).toContain("ECHO_ONCE_A");

    const read2 = (await tool.run(
      { action: "read", sessionId: opened.sessionId, since_offset: read1.nextOffset },
      contextA,
    )) as { output: string; nextOffset: number };
    expect(read2.output).not.toContain("ECHO_ONCE_A");
  });

  it.skipIf(!canSpawn)("3. max_bytes is respected and truncated is true when more is pending", async () => {
    const opened = (await tool.run({ action: "open" }, contextA)) as { sessionId: string };
    openedSessions.push(opened.sessionId);

    await tool.run(
      { action: "write", sessionId: opened.sessionId, data: "echo HELLO_PTY_LONG_STRING_ECHO\n" },
      contextA,
    );
    await pollRead(opened.sessionId, contextA, (o) => o.includes("LONG_STRING"));

    const bounded = (await tool.run(
      { action: "read", sessionId: opened.sessionId, since_offset: 0, max_bytes: 6 },
      contextA,
    )) as { output: string; nextOffset: number; truncated: boolean };
    expect(bounded.output.length).toBeLessThanOrEqual(6);
    expect(bounded.truncated).toBe(true);
  });

  it.skipIf(!canSpawn)("4. different principal cannot read, write or close the session (not-found)", async () => {
    const opened = (await tool.run({ action: "open" }, contextA)) as { sessionId: string };
    openedSessions.push(opened.sessionId);

    await expect(tool.run({ action: "read", sessionId: opened.sessionId }, contextB)).rejects.toThrow(
      /Unknown terminal session/,
    );
    await expect(
      tool.run({ action: "write", sessionId: opened.sessionId, data: "echo nope\n" }, contextB),
    ).rejects.toThrow(/Unknown terminal session/);
    await expect(tool.run({ action: "close", sessionId: opened.sessionId }, contextB)).rejects.toThrow(
      /Unknown terminal session/,
    );
  });

  it.skipIf(!canSpawn)("5. close makes later read report session gone or exited", async () => {
    const opened = (await tool.run({ action: "open" }, contextA)) as { sessionId: string };
    const closeRes = (await tool.run({ action: "close", sessionId: opened.sessionId }, contextA)) as {
      ok: boolean;
      closed: boolean;
    };
    expect(closeRes.ok).toBe(true);

    let exitedOrGone = false;
    const start = Date.now();
    while (!exitedOrGone && Date.now() - start < 3000) {
      try {
        const readRes = (await tool.run({ action: "read", sessionId: opened.sessionId }, contextA)) as {
          exited?: boolean;
        };
        if (readRes.exited) exitedOrGone = true;
      } catch (e) {
        if (/Unknown terminal session/i.test(String(e))) exitedOrGone = true;
      }
      if (!exitedOrGone) await new Promise((r) => setTimeout(r, 50));
    }
    expect(exitedOrGone).toBe(true);
  });

  it.skipIf(!canSpawn)("6. list shows only the caller's sessions", async () => {
    const openedA = (await tool.run({ action: "open" }, contextA)) as { sessionId: string };
    const openedB = (await tool.run({ action: "open" }, contextB)) as { sessionId: string };
    openedSessions.push(openedA.sessionId);

    const listA = (await tool.run({ action: "list" }, contextA)) as {
      sessions: Array<{ sessionId: string }>;
    };
    const listB = (await tool.run({ action: "list" }, contextB)) as {
      sessions: Array<{ sessionId: string }>;
    };

    expect(listA.sessions.some((s) => s.sessionId === openedA.sessionId)).toBe(true);
    expect(listA.sessions.some((s) => s.sessionId === openedB.sessionId)).toBe(false);

    expect(listB.sessions.some((s) => s.sessionId === openedB.sessionId)).toBe(true);
    expect(listB.sessions.some((s) => s.sessionId === openedA.sessionId)).toBe(false);

    await tool.run({ action: "close", sessionId: openedB.sessionId }, contextB);
  });

  it.skipIf(!canSpawn)("7. fake credential-prompt output sets promptSuspected", async () => {
    const opened = (await tool.run({ action: "open" }, contextA)) as { sessionId: string };
    openedSessions.push(opened.sessionId);

    await tool.run(
      { action: "write", sessionId: opened.sessionId, data: "printf 'Password: '\n" },
      contextA,
    );
    const readRes = await pollRead(opened.sessionId, contextA, (o) => o.toLowerCase().includes("password:"));
    expect(readRes.promptSuspected).toBe(true);
  });

  it("rejects unknown action", async () => {
    await expect(tool.run({ action: "invalid" }, contextA)).rejects.toThrow(/action must be/);
  });
});
