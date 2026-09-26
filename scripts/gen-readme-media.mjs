#!/usr/bin/env node
// Regenerate the README demo (docs/media/demo.gif) against a LIVE mso instance,
// so the recording tracks the current UI.
//
//   OS_MEDIA_DEVICE=<approved-device-id> node scripts/gen-readme-media.mjs
//
// Requires: the server running (default http://127.0.0.1:4005), an APPROVED device
// id (Settings → Account → Devices, or scripts/approve-device.js --list), OS_SESSION_SECRET in
// .env.local, the Playwright install under os-browser/, and ffmpeg (for the gif).
//
// It also shot docs/media/hero-desktop.png until 2026-07-30. README.md:42 has rendered
// docs/media/mso-hero.webp since, so that was 1.2 MB nothing referenced. openApp() and
// the throwaway ~/readme-showcase folder went with it: both existed only to make the
// file grid in that one screenshot read clean. The gif never opens Files.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "../os-browser/node_modules/playwright/index.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "media");
const TMP = path.join(os.tmpdir(), "mso-media");
const BASE = process.env.OS_MEDIA_BASE || "http://127.0.0.1:4005";
const DEVICE = process.env.OS_MEDIA_DEVICE;
if (!DEVICE) throw new Error("set OS_MEDIA_DEVICE=<approved-device-id> (scripts/approve-device.js --list)");

const secret = fs
  .readFileSync(path.join(ROOT, ".env.local"), "utf8")
  .match(/^OS_SESSION_SECRET=(.+)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");
if (!secret) throw new Error("OS_SESSION_SECRET not found in .env.local");

// Signed session cookie (same HMAC scheme as lib/auth) so Playwright is logged in.
const now = Date.now();
const enc = Buffer.from(JSON.stringify({ issued_at: now, expires_at: now + 3600e3, device_id: DEVICE })).toString("base64url");
const sig = Buffer.from(crypto.createHmac("sha256", secret).update(enc).digest()).toString("base64url");
const host = new URL(BASE).hostname;
const cookie = { name: "session", value: `${enc}.${sig}`, domain: host, path: "/" };
const seed = () => {
  localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
  localStorage.setItem("mso:tweaks", JSON.stringify({ theme: "dark" }));
};

const wait = (p, ms) => p.waitForTimeout(ms);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const b = await chromium.launch();
  try {
    // ── demo.gif: Spotlight (⌘K) → System Monitor (recorded → ffmpeg) ──
    {
      const c = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", recordVideo: { dir: TMP, size: { width: 1280, height: 800 } } });
      await c.addCookies([cookie]);
      await c.addInitScript(seed);
      const p = await c.newPage();
      await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 40000 });
      await wait(p, 3500);
      await p.keyboard.press("Meta+k"); // Spotlight
      await wait(p, 900);
      for (const ch of "monitor") { await p.keyboard.type(ch); await wait(p, 130); }
      await wait(p, 900);
      await p.keyboard.press("Enter");
      await wait(p, 2600);
      const video = p.video();
      await p.close();
      await c.close();
      const webm = await video.path();
      // webm → compact gif: skip the blank page-load, cap length, palette for quality.
      execFileSync("ffmpeg", ["-y", "-ss", "2.5", "-t", "6", "-i", webm, "-vf",
        "fps=10,scale=620:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
        path.join(OUT, "demo.gif")], { stdio: "ignore" });
      fs.rmSync(webm, { force: true });
      console.log("✓ demo.gif");
    }
  } finally {
    await b.close();
  }
}
main().then(() => console.log("done"));
