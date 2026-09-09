#!/usr/bin/env node
// Keep the mandatory release E2E runnable after @playwright/test changes the
// Chromium revision. Playwright packages and browser binaries are versioned
// separately, so `bun install` can leave a host with a new package that points at a
// browser revision not present in ~/.cache/ms-playwright. Self-update runs as the
// MSO owner: install only that package's Chromium binary, never sudo/system deps.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";

function browserPath() {
  return chromium.executablePath();
}

const expected = browserPath();
if (existsSync(expected)) {
  console.log(`Playwright Chromium ready: ${expected}`);
  process.exit(0);
}

console.log(
  "Playwright Chromium for this package revision is missing; installing it now…",
);
try {
  execFileSync(
    process.execPath,
    ["node_modules/playwright/cli.js", "install", "chromium"],
    {
      env: process.env,
      stdio: "inherit",
    },
  );
} catch {
  console.error(
    "Playwright Chromium bootstrap failed; release E2E cannot run safely.",
  );
  process.exit(1);
}

const installed = browserPath();
if (!existsSync(installed)) {
  console.error(
    `Playwright reported success but the expected Chromium executable is still missing: ${installed}`,
  );
  process.exit(1);
}

console.log(`Playwright Chromium installed and ready: ${installed}`);
