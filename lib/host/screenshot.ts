import { spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { currentSessionPolicy, listDevices } from "@/lib/auth/device-store";
import { signSession, MIN_SECRET_LEN } from "@/lib/auth/session";
import { configuredSessionCookieScope } from "@/lib/auth/session-cookie";

export type ScreenshotShell = "macos" | "windows" | "dashboard";

export interface ScreenshotResult {
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
  shell: ScreenshotShell;
}

type CdpMessage = { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown };

class CdpClient {
  private next = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  constructor(private ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      let msg: CdpMessage;
      try { msg = JSON.parse(raw) as CdpMessage; } catch { return; }
      if (msg.id == null) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
      else p.resolve(msg.result);
    });
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 12_000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

function clamp(n: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n as number), min), max);
}

async function waitForFile(file: string, ms = 8_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    if (raw.trim()) return raw;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error("Chrome did not expose its DevTools port");
}

async function openWs(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 8_000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP websocket failed")); }, { once: true });
  });
  return ws;
}

async function approvedDeviceId(): Promise<string> {
  const store = await listDevices();
  const candidates = Object.entries(store.approved)
    .sort(([, a], [, b]) => (b.lastSeen ?? b.approvedAt) - (a.lastSeen ?? a.approvedAt));
  if (!candidates.length) throw new Error("No approved MSO device exists; approve a browser first");
  return candidates[0][0];
}

function internalOrigin(): string {
  const raw = process.env.OS_SCREENSHOT_ORIGIN?.trim() || "http://127.0.0.1:4005";
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(raw)) {
    throw new Error("OS_SCREENSHOT_ORIGIN must be loopback http://127.0.0.1:<port> or localhost");
  }
  return raw;
}

export async function captureMsoScreen(opts?: {
  shell?: ScreenshotShell;
  width?: number;
  height?: number;
}): Promise<ScreenshotResult> {
  const shell: ScreenshotShell = opts?.shell && ["macos", "windows", "dashboard"].includes(opts.shell)
    ? opts.shell
    : "macos";
  const width = clamp(opts?.width, 900, 1920, 1440);
  const height = clamp(opts?.height, 600, 1200, 900);
  const secret = process.env.OS_SESSION_SECRET ?? "";
  if (secret.length < MIN_SECRET_LEN) throw new Error("OS_SESSION_SECRET is not configured strongly enough");
  const deviceId = await approvedDeviceId();
  const now = Date.now();
  const policy = await currentSessionPolicy(configuredSessionCookieScope());
  const session = signSession({ issued_at: now, expires_at: now + 5 * 60_000, device_id: deviceId, cookie_scope: policy.scope, cookie_epoch: policy.epoch }, secret);
  const origin = internalOrigin();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "mso-shot-"));
  let chrome: ChildProcess | undefined;
  let ws: WebSocket | undefined;

  try {
    chrome = spawn("/usr/bin/google-chrome", [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ], { stdio: "ignore" });

    const portInfo = await waitForFile(path.join(profile, "DevToolsActivePort"));
    const [port] = portInfo.trim().split(/\r?\n/);
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()) as Array<{
      type: string;
      webSocketDebuggerUrl?: string;
    }>;
    const target = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error("Chrome page target unavailable");
    ws = await openWs(target.webSocketDebuggerUrl);
    const cdp = new CdpClient(ws);

    await cdp.call("Page.enable");
    await cdp.call("Runtime.enable");
    await cdp.call("Network.enable");
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
      screenWidth: width, screenHeight: height,
    });
    const cookie = await cdp.call<{ success?: boolean }>("Network.setCookie", {
      name: "session",
      value: session,
      url: origin,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Strict",
    });
    if (cookie.success === false) throw new Error("Could not seed screenshot session cookie");

    const shellPrefs = JSON.stringify({ desktop: shell, mobile: "ios" });
    await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem('sv:shell', ${JSON.stringify(shellPrefs)}); } catch {}`,
    });
    await cdp.call("Page.navigate", { url: `${origin}/` });

    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      const r = await cdp.call<{ result?: { value?: boolean } }>("Runtime.evaluate", {
        expression: `Boolean(document.querySelector('#main-content[data-shell="${shell}"]'))`,
        returnByValue: true,
      }).catch(() => ({ result: { value: false } }));
      if (r.result?.value) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
    if (!ready) throw new Error(`MSO shell did not become ready for screenshot (${shell})`);
    await new Promise((resolve) => setTimeout(resolve, 650));

    const shot = await cdp.call<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (!shot.data) throw new Error("Chrome returned an empty screenshot");
    return { mimeType: "image/png", data: shot.data, width, height, shell };
  } finally {
    try { ws?.close(); } catch { /* noop */ }
    try { chrome?.kill("SIGTERM"); } catch { /* noop */ }
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}
