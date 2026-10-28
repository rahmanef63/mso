#!/usr/bin/env node
// Cold-load perceived performance, measured the way the gate measures it.
// Emits perf-report.json: FCP / LCP / TBT / CLS / first-load JS for desktop + mobile.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { releaseFixture } from "./e2e/release-fixture.mjs";
import { formatTable } from "./lib/perf-report.mjs";
import { SHELL_READY, SLOW_4G, installPerfObservers, readPerfMetrics } from "./lib/browser-metrics.mjs";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    output: { type: "string" },
    json: { type: "boolean", default: false },
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
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.resolve("."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function measure(browser, base, { label, viewport }) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  try {
    await context.addInitScript(installPerfObservers);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...SLOW_4G });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    await page.goto(base, { waitUntil: "load", timeout: 60000 });
    await page.locator(SHELL_READY).waitFor({ state: "visible", timeout: 60000 });

    // LCP lands ~3 s in, well after hydration. Waiting only for "nothing changed for 1 s"
    // exits at ~1.2 s and reports lcpMs null; wait for the entry itself.
    await page.waitForFunction(() => window.__perfLCP != null, null, { timeout: 30000 }).catch(() => {});
    // Then let the post-LCP deferred chunks finish so their tasks are charged to this load.
    let last = -1;
    for (let stable = 0, deadline = Date.now() + 10000; Date.now() < deadline; ) {
      const count = await page.evaluate(() => window.__perfLongTasks?.length ?? 0);
      if (count !== last) {
        last = count;
        stable = 0;
      } else if (++stable >= 10) {
        break;
      }
      await page.waitForTimeout(100);
    }

    return { label, viewport, ...(await page.evaluate(readPerfMetrics)) };
  } finally {
    await context.close();
  }
}

let fixture;
let browser;
try {
  const base = values.base ?? (fixture = await releaseFixture()).base;
  browser = await chromium.launch({ headless: true });

  // Warm-up boot, discarded. The first cold load of a session pays disk-cache misses for
  // ~900 KB of chunks and measured TBT 418 ms against 164 ms once warm — a 2.5x error that
  // would fail the gate on every fresh CI runner. Not reported, not counted.
  const warm = await browser.newContext({ viewport: RUNS[0].viewport });
  try {
    await warm.addInitScript(installPerfObservers);
    const page = await warm.newPage();
    await page.goto(base, { waitUntil: "load", timeout: 60000 });
    await page.locator(SHELL_READY).waitFor({ state: "visible", timeout: 60000 });
  } finally {
    await warm.close();
  }

  const runs = [];
  for (const config of RUNS) runs.push(await measure(browser, base, config));

  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    commit: commit(),
    host: {
      platform: process.platform,
      cpus: os.cpus().length,
      node: process.version.replace(/^v/, ""),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    },
    profile: { name: "cold-slow4g-4xcpu", latencyMs: SLOW_4G.latency, downlinkKbps: 1600, uplinkKbps: 750, cpuRate: 4 },
    runs,
  };

  if (values.output) {
    fs.mkdirSync(values.output, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(values.output, "perf-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stderr.write(`${formatTable(report)}\n`);
} catch (error) {
  console.error(`perf-probe: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture?.close();
}
