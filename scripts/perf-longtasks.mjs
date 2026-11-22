#!/usr/bin/env node
// Read-only diagnostic: attribute each long task on first load to the script that owns it.
// Not a gate — a finding here is information, not a failure (see check-perf.mjs for the gate).
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { releaseFixture } from "./e2e/release-fixture.mjs";
import { attributeLongTasks, formatLongTasks } from "./lib/trace-longtasks.mjs";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    "min-ms": { type: "string", default: "40" },
    output: { type: "string" },
    json: { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

const parsed = Number(values["min-ms"]);
const minMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 40;

const CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "v8.execute",
  "blink.user_timing",
  "disabled-by-default-v8.cpu_profiler",
].join(",");

let fixture;
let browser;
try {
  const base = values.base ?? (fixture = await releaseFixture()).base;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
    localStorage.setItem("mso:onboarding:v1", "done");
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  // Slow 4G (Lighthouse): 150 ms RTT, 1.6 Mbps down, 750 kbps up. Tracing an
  // unthrottled load finds different tasks than the ones the gate measures.
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 204800, uploadThroughput: 93750 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.start", { categories: CATEGORIES, transferMode: "ReturnAsStream" });

  await page.goto(base, { waitUntil: "load", timeout: 60000 });
  // The pre-hydration skeleton also has #main-content; data-shell means the shell mounted.
  await page.locator("#main-content[data-shell]").waitFor({ state: "visible", timeout: 60000 });
  // Deferred panels arrive after mount and are still part of the load cost.
  await page.waitForTimeout(3000);

  await cdp.send("Tracing.end");
  const { stream } = await complete;
  if (!stream) throw new Error("Tracing did not return a stream");

  let json = "";
  for (let eof = false; !eof; ) {
    const chunk = await cdp.send("IO.read", { handle: stream });
    json += chunk.data;
    eof = chunk.eof;
  }
  await cdp.send("IO.close", { handle: stream }).catch(() => {});

  const result = attributeLongTasks(JSON.parse(json), { minMs });
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), minMs, ...result };

  if (values.output) {
    mkdirSync(values.output, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(values.output, "perf-longtasks.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  console.log(values.json ? JSON.stringify(report, null, 2) : formatLongTasks(result, minMs));
} catch (error) {
  console.error(`perf-longtasks: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await fixture?.close();
}
