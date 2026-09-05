#!/usr/bin/env node
import { verifyServedStaticAssets, waitForServedRoot } from "./lib/served-assets.mjs";

const base = process.argv[2] || "http://127.0.0.1:4005";
try {
  if (process.argv[3] !== undefined) {
    if (process.argv[3] !== "--wait-ms" || process.argv.length !== 5) throw new Error("usage: check-served-assets.mjs [origin] [--wait-ms 1..60000]");
    await waitForServedRoot(base, Number(process.argv[4]));
  }
  const result = await verifyServedStaticAssets(base);
  console.log(`asset graph OK: ${result.assetCount} referenced JS/CSS assets`);
} catch (error) {
  console.error(`asset graph FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
