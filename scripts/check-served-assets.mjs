#!/usr/bin/env node
import { verifyServedStaticAssets } from "./lib/served-assets.mjs";

const base = process.argv[2] || "http://127.0.0.1:4005";
try {
  const result = await verifyServedStaticAssets(base);
  console.log(`asset graph OK: ${result.assetCount} referenced JS/CSS assets`);
} catch (error) {
  console.error(`asset graph FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
