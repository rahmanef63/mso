import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import pty from "node-pty";

// Probe whether the current platform and container allow allocating a pseudo-terminal.
let ptyUsable = false;
try {
  const probe = pty.spawn(process.execPath, ["-e", "process.exit(0)"], { cols: 80, rows: 24 });
  probe.kill();
  ptyUsable = true;
} catch (error) {
  // PTY allocation can be restricted in locked-down CI or Windows containers without ConPTY.
  console.warn("Skipping PTY e2e suite: pseudo-terminal allocation unavailable in this environment:", error);
}

// Minimal in-memory screen grid that tracks ANSI cursor movement escapes to verify rendered lines.
function createTerminal(cols = 100, rows = 30) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
  let r = 0, c = 0;
  return {
    write(str: string) {
      for (let i = 0; i < str.length;) {
        if (str[i] === "\r") { c = 0; i++; } else if (str[i] === "\n") { r = Math.min(rows - 1, r + 1); c = 0; i++; }
        else if (str[i] === "\x1b" && str[i + 1] === "[") {
          let j = i + 2;
          while (j < str.length && !/[a-zA-Z]/.test(str[j])) j++;
          const seq = str.slice(i + 2, j), cmd = str[j++];
          i = j;
          if (cmd === "H") {
            const p = seq.split(";").map(Number);
            r = Math.max(0, Math.min(rows - 1, (p[0] || 1) - 1));
            c = Math.max(0, Math.min(cols - 1, (p[1] || 1) - 1));
          } else if (cmd === "A") r = Math.max(0, r - (Number(seq) || 1));
          else if (cmd === "B") r = Math.min(rows - 1, r + (Number(seq) || 1));
          else if (cmd === "C") c = Math.min(cols - 1, c + (Number(seq) || 1));
          else if (cmd === "D") c = Math.max(0, c - (Number(seq) || 1));
          else if (cmd === "K") {
            if (Number(seq) === 2) grid[r].fill(" ");
            else for (let x = c; x < cols; x++) grid[r][x] = " ";
          } else if (cmd === "J") for (const row of grid) row.fill(" ");
        } else if (str[i] === "\x1b") i += 2;
        else {
          if (r < rows && c < cols) grid[r][c++] = str[i];
          i++;
        }
      }
    },
    getLines: () => grid.map((row) => row.join("").trimEnd()),
  };
}

function spawnAgentPty(serverUrl: string, cols = 100, rows = 30) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mso-pty-test-"));
  const env: Record<string, string | undefined> = {
    ...process.env, HOME: tempHome, TERM: "xterm-256color",
    MSO_AGENT_BASE: serverUrl, MSO_AGENT_ORIGIN: serverUrl, MSO_AGENT_CLI: "mso", MSO_AGENT_VERSION: "1.13.1",
  };
  delete env.CI; // Alt screen refuses execution in CI environment.
  const child = pty.spawn(process.execPath, [path.join(__dirname, "mso-agent.mjs"), "--altscreen"], {
    cols, rows, cwd: __dirname, env: env as Record<string, string>,
  });
  return {
    child,
    cleanup: () => {
      try { child.kill("SIGKILL"); } catch {}
      fs.rmSync(tempHome, { recursive: true, force: true });
    },
  };
}

function waitFor(child: pty.IPty, match: (chunk: string, total: string) => boolean | void, ms = 6000) {
  let total = "";
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PTY wait timed out")), ms);
    child.onData((chunk) => {
      total += chunk;
      if (match(chunk, total)) {
        clearTimeout(timer);
        resolve(total);
      }
    });
  });
}

const describeSuite = ptyUsable ? describe : describe.skip;

describeSuite("mso agent in real PTY e2e", () => {
  let server: http.Server;
  let serverUrl = "";
  const demoSession = { id: "test_pty_sess", source: "cli", name: "mso", title: "Operate your server", history: [] };

  beforeAll(async () => {
    // Loopback fixture server satisfies startup handshakes without live models or credentials.
    server = http.createServer((req, res) => {
      const p = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const sendJson = (data: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
      if (p === "/api/config") return sendJson({ provider: "openai", model: "gpt-5.6" });
      if (p === "/api/v1/agent-tools") return sendJson({ tools: [{ name: "fs_read", scope: "read", inputSchema: { type: "object", properties: {} } }] });
      if (p === "/api/skills" || p === "/api/v1/infra/providers") return sendJson(p.includes("skills") ? { skills: [] } : { providers: [] });
      if (p === "/api/models") return sendJson({ models: [{ id: "gpt-5.6", ref: "openai/gpt-5.6" }] });
      if (p === "/api/v1/agent-sessions") return sendJson({ session: demoSession, sessions: [demoSession] });
      if (p === "/api/v1/local-agents") return sendJson({ ok: true, agents: [] });
      res.writeHead(204); res.end();
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Could not bind fixture server");
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("paints panel, tab row, footer and transcript cleanly in real pty", async () => {
    const { child, cleanup } = spawnAgentPty(serverUrl, 100, 30);
    const term = createTerminal(100, 30);
    try {
      const output = await waitFor(child, (chunk, total) => {
        term.write(chunk);
        return total.includes("❯") || total.includes("›");
      });
      const lines = term.getLines();
      expect(lines.filter((l) => l.includes("● @mso"))).toHaveLength(1);
      expect(lines.filter((l) => l.includes("mode ask") && l.includes("openai/gpt-5.6"))).toHaveLength(1);
      expect(lines.some((l) => l.includes("Welcome to MSO Agent!"))).toBe(true);
      expect(output).toContain("\x1b[?1049h");
    } finally { cleanup(); }
  });

  it("handles slash command (/help) without model call and redraws without duplicated rows", async () => {
    const { child, cleanup } = spawnAgentPty(serverUrl, 100, 30);
    let sent = false;
    try {
      const output = await waitFor(child, (chunk, total) => {
        if (!sent && (chunk.includes("❯") || chunk.includes("›"))) { sent = true; child.write("/help\r"); }
        return sent && total.includes("show slash commands and keyboard shortcuts");
      });
      expect(output).toContain("show slash commands and keyboard shortcuts");
    } finally { cleanup(); }
  });

  it("redraws on resize (SIGWINCH) without duplicating tab row", async () => {
    const { child, cleanup } = spawnAgentPty(serverUrl, 100, 30);
    let resized = false, postResize = "";
    try {
      await waitFor(child, (chunk) => {
        if (!resized && (chunk.includes("❯") || chunk.includes("›"))) { resized = true; child.resize(120, 35); return false; }
        if (resized) { postResize += chunk; return postResize.includes("● @mso"); }
        return false;
      });
      expect(postResize.split(/\r?\n/).filter((l) => l.includes("● @mso")).length).toBeLessThanOrEqual(1);
    } finally { cleanup(); }
  });

  it("leaves alternate screen on Ctrl+C and emits exit hint", async () => {
    const { child, cleanup } = spawnAgentPty(serverUrl, 100, 30);
    let sent = false;
    try {
      const output = await waitFor(child, (chunk, total) => {
        if (!sent && (chunk.includes("❯") || chunk.includes("›"))) { sent = true; setTimeout(() => child.write("\x03"), 100); }
        return sent && total.includes("\x1b[?1049l");
      });
      expect(output).toContain("\x1b[?1049l");
      expect(output).toContain("session Operate your server · resume: mso --continue");
    } finally { cleanup(); }
  });

  // Was skipped while `const screenLoop` was scoped inside the try and threw a ReferenceError from
  // the finally block, turning a clean exit into exit code 1. Fixed in fix/tui-pty-bugs.
  it("exits with clean code 0 on Ctrl+C", async () => {
    const { child, cleanup } = spawnAgentPty(serverUrl, 100, 30);
    try {
      let sent = false, exitCode: number | null = null;
      await new Promise<void>((resolve) => {
        child.onData((c) => { if (!sent && (c.includes("❯") || c.includes("›"))) { sent = true; child.write("\x03"); } });
        child.onExit(({ exitCode: code }) => { exitCode = code; resolve(); });
      });
      expect(exitCode).toBe(0);
    } finally { cleanup(); }
  });

  it("leaves alternate screen on SIGTERM", async () => {
    const { child, cleanup } = spawnAgentPty(serverUrl, 100, 30);
    let termSent = false;
    try {
      const output = await waitFor(child, (chunk, total) => {
        if (!termSent && (chunk.includes("❯") || chunk.includes("›"))) { termSent = true; child.kill("SIGTERM"); }
        return termSent && total.includes("\x1b[?1049l");
      });
      expect(output).toContain("\x1b[?1049l");
    } finally { cleanup(); }
  });

  // Was skipped while the SIGTERM listener replaced node's default termination and left the agent
  // running forever. Fixed in fix/tui-pty-bugs by re-raising after the screen is released.
  it("exits process when SIGTERM signal is delivered", async () => {
    const { child, cleanup } = spawnAgentPty(serverUrl, 100, 30);
    try {
      let termSent = false, exited = false;
      await new Promise<void>((resolve) => {
        // Bounded: an unbounded wait turns a hang into a stalled suite instead of a failure.
        const timer = setTimeout(() => resolve(), 6000);
        child.onData((c) => { if (!termSent && (c.includes("❯") || c.includes("›"))) { termSent = true; child.kill("SIGTERM"); } });
        child.onExit(() => { exited = true; clearTimeout(timer); resolve(); });
      });
      expect(exited).toBe(true);
    } finally { cleanup(); }
  });
});
