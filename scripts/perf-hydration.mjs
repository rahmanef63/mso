#!/usr/bin/env node
// Cold-load hydration timeline diagnostic: measures FCP, last JS, mounted, icons, LCP.
// Emits perf-hydration.json with hydration marks and critical-path deltas.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { releaseFixture } from "./e2e/release-fixture.mjs";
import { SLOW_4G, SHELL_READY } from "./lib/browser-metrics.mjs";
import { installMarks, readMarks } from "./lib/hydration-marks.mjs";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    output: { type: "string" },
    json: { type: "boolean", default: false },
    cpu: { type: "string", default: "4" },
    net: { type: "string", default: "slow4g" },
  },
  strict: true,
  allowPositionals: false,
});

const RUNS = [
  { label: "desktop", viewport: { width: 1440, height: 900 } },
  { label: "mobile", viewport: { width: 390, height: 844 } },
];

function commit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: path.resolve("."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

async function measure(browser, base, { label, viewport }, { cpuRate, isNetThrottled }) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  try {
    await context.addInitScript(installMarks);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    if (isNetThrottled) {
      await cdp.send("Network.emulateNetworkConditions", { offline: false, ...SLOW_4G });
    }
    if (cpuRate > 1) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    }

    await page.goto(base, { waitUntil: "load", timeout: 60000 });
    try {
      await page.locator("#main-content[data-shell]").waitFor({ state: "attached", timeout: 60000 });
    } catch {
      // Shell failed to mount within timeout; mounted remains null
    }

    // Wait for LCP observer to record the post-mount element
    await page.waitForFunction(() => window.__marks?.lcp != null, null, { timeout: 30000 }).catch(() => {});
    // Allow icons and interactive elements to finish rendering
    await page.waitForTimeout(2000);

    const raw = await page.evaluate(readMarks);
    const mountAfterFcpMs = raw.mounted != null && raw.fcp != null ? raw.mounted - raw.fcp : null;
    const lcpAfterFcpMs = raw.lcp != null && raw.fcp != null ? raw.lcp - raw.fcp : null;
    const lcpAfterLastJsMs = raw.lcp != null && raw.lastJsDone != null ? raw.lcp - raw.lastJsDone : null;

    return {
      label,
      viewport,
      ...raw,
      mountAfterFcpMs,
      lcpAfterFcpMs,
      lcpAfterLastJsMs,
    };
  } finally {
    await context.close();
  }
}

function formatTable(report) {
  const headers = [
    "surface",
    "fcp",
    "mounted",
    "icons",
    "interact",
    "lcp",
    "tag",
    "lastJs",
    "+mount(fcp)",
    "+lcp(fcp)",
    "+lcp(js)",
    "jsKB",
  ];
  const rows = report.runs.map((r) => [
    r.label,
    r.fcp != null ? `${r.fcp}ms` : "null",
    r.mounted != null ? `${r.mounted}ms` : "null",
    r.icons != null ? `${r.icons}ms` : "null",
    r.interactive != null ? `${r.interactive}ms` : "null",
    r.lcp != null ? `${r.lcp}ms` : "null",
    r.lcpTag ?? "null",
    r.lastJsDone != null ? `${r.lastJsDone}ms` : "null",
    r.mountAfterFcpMs != null ? `+${r.mountAfterFcpMs}ms` : "null",
    r.lcpAfterFcpMs != null ? `+${r.lcpAfterFcpMs}ms` : "null",
    r.lcpAfterLastJsMs != null ? `+${r.lcpAfterLastJsMs}ms` : "null",
    r.firstLoadJsBytes != null ? `${(r.firstLoadJsBytes / 1024).toFixed(1)}KB` : "null",
  ]);
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) => Math.max(...allRows.map((row) => row[i].length)));
  return allRows.map((row) => row.map((c, i) => (i === row.length - 1 ? c : c.padEnd(colWidths[i]))).join("  ")).join("\n");
}

let fixture;
let browser;
try {
  const base = values.base ?? (fixture = await releaseFixture()).base;
  browser = await chromium.launch({ headless: true });

  const cpuRate = Math.max(1, Number(values.cpu) || 4);
  const isNetThrottled = values.net !== "none";
  const throttle = {
    latencyMs: isNetThrottled ? SLOW_4G.latency : 0,
    downloadKbps: isNetThrottled ? 1600 : 0,
    cpuRate,
  };

  // Warm-up boot, discarded, same reason as perf-probe: a session's first cold load pays
  // disk-cache misses for ~940 KB of chunks and inflates every mark by a few hundred ms,
  // which would publish numbers that disagree with perf:probe for the same commit.
  const warm = await browser.newContext({ viewport: RUNS[0].viewport, reducedMotion: "reduce" });
  try {
    await warm.addInitScript(installMarks);
    const page = await warm.newPage();
    await page.goto(base, { waitUntil: "load", timeout: 60000 });
    await page.locator(SHELL_READY).waitFor({ state: "visible", timeout: 60000 });
  } finally {
    await warm.close();
  }

  const runs = [];
  for (const config of RUNS) {
    runs.push(await measure(browser, base, config, { cpuRate, isNetThrottled }));
  }

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    commit: commit(),
    throttle,
    runs,
  };

  if (values.output) {
    fs.mkdirSync(values.output, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(values.output, "perf-hydration.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatTable(report)}\n`);
  }

  if (runs.some((r) => r.mounted == null)) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`perf-hydration: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture?.close();
}
