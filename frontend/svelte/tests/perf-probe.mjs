// Side-by-side cold-load probe for the isolated Svelte static entry.
//
// Uses the same definitions as scripts/lib/browser-metrics.mjs so the numbers are
// comparable with scripts/perf-baseline.json: TBT clamps each long task at 50 ms,
// LCP takes the last candidate, CLS ignores recent input. Cold load over Slow 4G
// with 4x CPU throttling, same profile as the committed Next baseline.
//
// Backend responses are synthetic and scoped to this fixture. Nothing here contacts
// a deployment, a private store or the production origin.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const session = { authenticated: true, deviceId: "fixture", deviceLabel: "Probe fixture", role: "viewer" };
const stats = {
  cpu: { pct: 12, cores: 4 },
  mem: { used: 1024 ** 3, total: 4 * 1024 ** 3 },
  disk: { used: 2 * 1024 ** 3, total: 8 * 1024 ** 3 },
  uptime: 3_660_000,
};

const backend = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/api/auth/me") response.end(JSON.stringify(session));
  else if (request.url === "/api/v1/sys/stats") response.end(JSON.stringify(stats));
  else { response.statusCode = 404; response.end("{}"); }
});
backend.listen(0, "127.0.0.1");
await once(backend, "listening");
const apiOrigin = `http://127.0.0.1:${backend.address().port}`;

const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "0", "--strictPort", "false"], {
  env: { ...process.env, MSO_SVELTE_API_ORIGIN: apiOrigin },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
preview.stdout.on("data", (chunk) => { log += chunk; });
preview.stderr.on("data", (chunk) => { log += chunk; });

let base;
for (let i = 0; i < 100; i += 1) {
  const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(log);
  if (match) { base = `http://127.0.0.1:${match[1]}/`; break; }
  await delay(100);
}
if (!base) throw new Error(`vite preview did not report a loopback origin. Log:\n${log}`);

const browser = await chromium.launch();
const profile = {
  name: "cold-slow4g-4xcpu",
  latencyMs: 150,
  downlinkKbps: 1600,
  uplinkKbps: 750,
  cpuRate: 4,
};

const observers = () => {
  window.__perfLongTasks = [];
  window.__perfCLS = 0;
  window.__perfLCP = null;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__perfLongTasks.push({ duration: entry.duration, startTime: entry.startTime });
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => {
    const last = list.getEntries().pop();
    if (last) window.__perfLCP = last.renderTime || last.loadTime || last.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__perfCLS += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
};

const read = () => {
  const paint = performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint");
  const longTasks = window.__perfLongTasks ?? [];
  const resources = performance.getEntriesByType("resource");
  const js = resources.filter((entry) => new URL(entry.name).pathname.endsWith(".js"));
  return {
    fcpMs: paint ? Math.round(paint.startTime) : null,
    lcpMs: window.__perfLCP == null ? null : Math.round(window.__perfLCP),
    tbtMs: Math.round(longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)),
    cls: Number((window.__perfCLS ?? 0).toFixed(4)),
    longTasks: longTasks.length,
    maxLongTaskMs: Math.round(longTasks.reduce((max, task) => Math.max(max, task.duration), 0)),
    firstLoadJsBytes: js.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    firstLoadJsFiles: js.length,
    transferBytes: resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
    domNodes: document.querySelectorAll("*").length,
  };
};

const runs = [];
try {
  for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    for (let pass = 0; pass < 3; pass += 1) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: profile.latencyMs,
        downloadThroughput: (profile.downlinkKbps * 1024) / 8,
        uploadThroughput: (profile.uplinkKbps * 1024) / 8,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
      await page.addInitScript(observers);
      await page.goto(base, { waitUntil: "load" });
      try { await page.waitForSelector("[data-monitor-state='ready']", { timeout: 20_000 }); } catch {}
      await delay(2_500);
      const metrics = await page.evaluate(read);
      // First pass of a session is warm-up: the cold page cache inflates TBT.
      if (pass > 0) runs.push({ label, viewport, ...metrics });
      await context.close();
    }
  }
} finally {
  await browser.close();
  preview.kill("SIGTERM");
  backend.close();
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const summary = ["desktop", "mobile"].map((label) => {
  const rows = runs.filter((run) => run.label === label);
  const pick = (key) => median(rows.map((row) => row[key]));
  return {
    label,
    fcpMs: pick("fcpMs"),
    lcpMs: pick("lcpMs"),
    tbtMs: pick("tbtMs"),
    cls: Number(median(rows.map((row) => row.cls * 10_000)) / 10_000),
    longTasks: pick("longTasks"),
    firstLoadJsBytes: pick("firstLoadJsBytes"),
    firstLoadJsFiles: pick("firstLoadJsFiles"),
    transferBytes: pick("transferBytes"),
    domNodes: pick("domNodes"),
    samples: rows.length,
  };
});

console.log(JSON.stringify({ profile, base, runs, summary }, null, 2));
