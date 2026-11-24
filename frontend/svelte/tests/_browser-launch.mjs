import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "@playwright/test";

function findCachedBinary(prefix, relBinary) {
  const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), ".cache", "ms-playwright");
  if (!existsSync(cacheDir)) return undefined;
  const dirs = readdirSync(cacheDir)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidate = path.join(cacheDir, dir, relBinary);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function launchChromium(options = {}) {
  const defaultPath = chromium.executablePath();
  if (defaultPath && existsSync(defaultPath)) {
    return chromium.launch({ headless: true, ...options });
  }
  const fallback =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || findCachedBinary("chromium_headless_shell-", "chrome-headless-shell-linux64/chrome-headless-shell")
    || findCachedBinary("chromium-", "chrome-linux64/chrome");
  return chromium.launch({ headless: true, ...(fallback ? { executablePath: fallback } : {}), ...options });
}

export async function launchWebKit(options = {}) {
  const defaultPath = webkit.executablePath();
  if (defaultPath && existsSync(defaultPath)) {
    return webkit.launch({ headless: true, ...options });
  }
  const fallback =
    process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE
    || findCachedBinary("webkit-", "pw_run.sh");
  return webkit.launch({ headless: true, ...(fallback ? { executablePath: fallback } : {}), ...options });
}
