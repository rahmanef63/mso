#!/usr/bin/env node
// Capture the real CLI in a PTY, then render those bytes with xterm. No provider/account is used.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pty = require("node-pty");
const { chromium } = require(path.join(root, "os-browser/node_modules/playwright"));
const sharp = require("sharp");
const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "mso-cli-capture-"));
const env = { ...process.env, HOME: temporaryHome, TERM: "xterm-256color" };
for (const key of Object.keys(env)) if (/^(?:MSO_|OS_|GH_|GITHUB_|OPENAI_|ANTHROPIC_|BUN_|NODE_OPTIONS)/.test(key)) delete env[key];
let browser;
try {
  const output = await new Promise((resolve, reject) => {
    const child = pty.spawn("/bin/bash", [path.join(root, "bin/mso"), "reset", "--help"], {
      name: "xterm-256color", cols: 112, rows: 30, cwd: root, env,
    });
    let text = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("CLI capture timed out")); }, 10000);
    child.onData((value) => { text += value; });
    child.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode !== 0) reject(new Error("CLI capture failed")); else resolve(text);
    });
  });
  if (!String(output).includes("PREVIEW ONLY")) throw new Error("Expected maintenance CLI output was not captured");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1160, height: 810 }, deviceScaleFactor: 1.5 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><main id="capture"><header><span class="dots">● ● ●</span><span>Manef Shell OS · terminal</span><span class="badge">ACTUAL CLI OUTPUT</span></header><div class="command">$ mso reset --help</div><div id="terminal"></div><footer>Preview first. Apply only with explicit confirmation.</footer></main></body></html>`);
  await page.addStyleTag({ path: path.join(path.dirname(require.resolve("@xterm/xterm")), "../css/xterm.css") });
  await page.addStyleTag({ content: `*{box-sizing:border-box}body{margin:0;padding:24px;background:#f4f4f7;font-family:Arial,sans-serif}main{background:#1b1b20;border:1px solid #363640;border-radius:16px;overflow:hidden;padding:0 24px 18px;color:#f2f2f5}header{height:62px;display:flex;gap:20px;align-items:center;border-bottom:1px solid #363640;font-size:13px;color:#c5c5ce}.dots{letter-spacing:5px;color:#92929d}.badge{margin-left:auto;letter-spacing:1px;font-size:10px}.command{padding:20px 0 14px;font:600 15px monospace;color:#83afff}footer{border-top:1px solid #363640;padding-top:14px;color:#aaaab8;font-size:12px}#terminal{padding-bottom:12px}` });
  await page.addScriptTag({ path: require.resolve("@xterm/xterm") });
  await page.evaluate(async (text) => {
    const terminal = new window.Terminal({ cols: 112, rows: 29, fontSize: 14, lineHeight: 1.2, fontFamily: "monospace", convertEol: true, cursorBlink: false,
      theme: { background: "#1b1b20", foreground: "#f2f2f5", cursor: "#83afff" } });
    terminal.open(document.getElementById("terminal"));
    await new Promise((resolve) => terminal.write(text, resolve));
    terminal.scrollToTop();
  }, String(output));
  await page.evaluate(() => document.fonts.ready);
  const image = await page.locator("#capture").screenshot({ type: "png" });
  const target = path.join(root, "docs/media/mso-cli.webp");
  await sharp(image).webp({ lossless: true }).toFile(target);
  console.log(`Captured real CLI output: ${path.relative(root, target)} (${fs.statSync(target).size} bytes)`);
} finally {
  if (browser) await browser.close();
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
