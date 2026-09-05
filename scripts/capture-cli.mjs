#!/usr/bin/env node
// Capture the actual interactive `mso` Agent renderer in a PTY. A loopback-only
// fixture supplies bounded non-secret runtime metadata so the screenshot is
// reproducible and never depends on an owner's provider credentials or sessions.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pty = require("node-pty");
const { chromium } = require(path.join(root, "os-browser/node_modules/playwright"));
const sharp = require("sharp");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "mso-cli-capture-"));
const demoSession = {
  id: "cli_capture_readme", source: "cli", name: "mso", title: "Operate your server", history: [],
};
const tools = [
  { name: "fs_read", scope: "read" }, { name: "fs_write", scope: "write" },
  { name: "sys_stats", scope: "read" }, { name: "exec_run", scope: "exec" },
  { name: "projects_list", scope: "read" }, { name: "workflow_start", scope: "write" },
  { name: "skills_search", scope: "read" }, { name: "cloudflare_zones", scope: "read" },
  { name: "dokploy_projects", scope: "read" }, { name: "hostinger_mail_list", scope: "read" },
].map((tool) => ({ ...tool, description: "README capture fixture", inputSchema: { type: "object", properties: {} } }));
const skills = [
  { id: "deploy", category: "operations" }, { id: "security-audit", category: "operations" },
  { id: "frontend", category: "project" }, { id: "docs", category: "project" },
];

function json(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}
function fixtureServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/config") return json(res, { provider: "openai", model: "gpt-5.6" });
    if (req.method === "GET" && url.pathname === "/api/v1/agent-tools") return json(res, { tools });
    if (req.method === "GET" && url.pathname === "/api/skills") return json(res, { skills });
    if (req.method === "GET" && url.pathname === "/api/v1/infra/providers") return json(res, { providers: [
      { id: "github", configured: true }, { id: "cloudflare", configured: true },
      { id: "hostinger", configured: true }, { id: "dokploy", configured: false },
    ] });
    if (req.method === "GET" && url.pathname === "/api/models") return json(res, { models: [{ id: "gpt-5.6", ref: "openai/gpt-5.6" }] });
    if (req.method === "POST" && url.pathname === "/api/v1/agent-sessions") return json(res, { session: demoSession });
    if (req.method === "GET" && url.pathname === "/api/v1/agent-sessions") return json(res, { session: demoSession, sessions: [demoSession] });
    if (req.method === "POST" && url.pathname === "/api/v1/local-agents") return json(res, { ok: true, messages: [] });
    if (req.method === "GET" && url.pathname === "/api/v1/local-agents") {
      if (url.searchParams.get("stream") === "1") { res.writeHead(204); return res.end(); }
      return json(res, { agents: [] });
    }
    return json(res, { error: "capture fixture route not implemented" }, 404);
  });
}

let browser;
let server;
try {
  server = fixtureServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind CLI capture fixture");
  const base = `http://127.0.0.1:${address.port}`;
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin", HOME: temporaryHome, TERM: "xterm-256color",
    MSO_AGENT_BASE: base, MSO_AGENT_ORIGIN: base, MSO_AGENT_VERSION: version, MSO_AGENT_CLI: "mso",
  };
  const output = await new Promise((resolve, reject) => {
    const child = pty.spawn(process.execPath, [path.join(root, "scripts/mso-agent.mjs")], {
      name: "xterm-256color", cols: 118, rows: 34, cwd: root, env,
    });
    let text = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const snapshot = text;
      try { child.kill("SIGTERM"); } catch {}
      error ? reject(error) : resolve(snapshot);
    };
    const timer = setTimeout(() => finish(new Error("Interactive CLI capture timed out")), 12_000);
    child.onData((value) => {
      text += value;
      if (text.includes("Welcome to MSO Agent!") && text.includes("@mso")) setTimeout(() => finish(), 250);
    });
    child.onExit(({ exitCode }) => {
      if (!settled) finish(new Error(`Interactive CLI exited before capture (${exitCode})`));
    });
  });
  if (!String(output).includes("Welcome to MSO Agent!") || !String(output).includes("Available Tools")) {
    throw new Error("Actual interactive MSO Agent surface was not captured");
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1260, height: 920 }, deviceScaleFactor: 1.5 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><main id="capture"><header><span class="dots">● ● ●</span><span>Manef Shell OS · terminal</span><span class="badge">INTERACTIVE MSO AGENT</span></header><div class="command">$ mso</div><div id="terminal"></div><footer>Actual MSO Agent renderer · reproducible loopback fixture · no provider credentials used.</footer></main></body></html>`);
  await page.addStyleTag({ path: path.join(path.dirname(require.resolve("@xterm/xterm")), "../css/xterm.css") });
  await page.addStyleTag({ content: `*{box-sizing:border-box}body{margin:0;padding:24px;background:#f4f4f7;font-family:Arial,sans-serif}main{background:#17171c;border:1px solid #34343e;border-radius:16px;overflow:hidden;padding:0 24px 18px;color:#f2f2f5}header{height:58px;display:flex;gap:20px;align-items:center;border-bottom:1px solid #34343e;font-size:13px;color:#c5c5ce}.dots{letter-spacing:5px;color:#92929d}.badge{margin-left:auto;letter-spacing:1px;font-size:10px}.command{padding:16px 0 8px;font:600 15px monospace;color:#83afff}footer{border-top:1px solid #34343e;padding-top:12px;color:#aaaab8;font-size:11px}#terminal{padding-bottom:8px}` });
  await page.addScriptTag({ path: require.resolve("@xterm/xterm") });
  await page.evaluate(async (text) => {
    const terminal = new window.Terminal({ cols: 118, rows: 34, fontSize: 12, lineHeight: 1.1, fontFamily: "monospace", convertEol: true, cursorBlink: false,
      theme: { background: "#17171c", foreground: "#f2f2f5", cursor: "#83afff" } });
    terminal.open(document.getElementById("terminal"));
    await new Promise((resolve) => terminal.write(text, resolve));
    terminal.scrollToTop();
  }, String(output));
  await page.evaluate(() => document.fonts.ready);
  const image = await page.locator("#capture").screenshot({ type: "png" });
  const target = path.join(root, "docs/media/mso-cli.webp");
  await sharp(image).webp({ lossless: true }).toFile(target);
  console.log(`Captured interactive mso: ${path.relative(root, target)} (${fs.statSync(target).size} bytes)`);
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(() => resolve()));
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
