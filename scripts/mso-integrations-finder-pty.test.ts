import { afterAll, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import pty from "node-pty";

const dir = mkdtempSync(path.join(os.tmpdir(), "mso-integrations-pty-"));
const config = path.join(dir, "finder.json");
const SECRET = "PTY_SYNTHETIC_SECRET_MUST_NOT_RENDER";
writeFileSync(config, JSON.stringify({
  snapshot: {
    user: "alice",
    users: [{ id: "alice", label: "Alice", isDefault: true, connectionCount: 1 }],
    catalog: [{ id: "github", title: "GitHub", description: "GitHub account", sources: [{ id: "direct", label: "MSO direct", methods: [{ id: "direct", label: "Direct", scope: "account", fields: [{ key: "apiKey", value: SECRET }] }] }] }],
    connections: [{ user: "alice", id: "work", label: "Work", provider: "github", source: "direct", authMethod: "direct", scope: "account", state: "verified", isDefault: true, fields: [{ key: "apiKey", stored: true, value: SECRET }] }],
  },
  stack: ["connections", "user:alice", "provider:github", "connection:work"],
  activity: [],
}), { mode: 0o600 });
chmodSync(config, 0o600);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(cols: number, rows: number) {
  return new Promise<string>((resolve, reject) => {
    const child = pty.spawn(process.execPath, [path.join(__dirname, "mso-integrations-finder.mjs"), config], {
      cols, rows, cwd: __dirname, env: { ...process.env, NO_COLOR: "1" }, name: "xterm-256color",
    });
    let output = "", sent = false;
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error(`PTY ${cols}x${rows} timed out`)); }, 3000);
    child.onData((data) => {
      output += data;
      if (!sent && output.includes("INSPECTOR")) { sent = true; child.write("\x04"); }
    });
    child.onExit(() => { clearTimeout(timer); resolve(output); });
  });
}

it.each([[60,20],[80,24],[100,30],[120,32],[150,40],[200,50]])("paints and exits cleanly in a real %ix%i PTY", async (cols, rows) => {
  const output = await run(cols, rows);
  expect(output).toContain("MSO");
  expect(output).toContain("Integrations");
  expect(output).toContain("INSPECTOR");
  expect(output).toContain("┌");
  expect(output).toContain("┘");
  expect(output).not.toContain(SECRET);
  expect(output).toContain('"type":"quit"');
});
