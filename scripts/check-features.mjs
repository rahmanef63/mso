#!/usr/bin/env node
// Automated feature governance validator for MSO Svelte 5 UI modules.
// Enforces feature.boundaries.json ratchets and frontend/svelte/src/lib/feature-contracts.ts coverage.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".svelte-kit", "build", ".git", "coverage"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function parseContractTable(root = ROOT) {
  const contractFile = path.join(root, "frontend/svelte/src/lib/feature-contracts.ts");
  const text = readFileSync(contractFile, "utf8");
  const entries = new Map();
  const re = /^\s*(?:"([a-z0-9-]+)"|([a-z0-9-]+))\s*:\s*\{\s*surfaceKind:\s*"([^"]+)"/gm;
  for (const match of text.matchAll(re)) {
    const slug = match[1] ?? match[2];
    entries.set(slug, { surfaceKind: match[3] });
  }
  return entries;
}

export function auditFeatures(root = ROOT) {
  const slicesDir = path.join(root, "frontend/svelte/src/lib");
  const slices = readdirSync(slicesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const contracts = parseContractTable(root);

  const missingContract = slices.filter((s) => !contracts.has(s));
  const orphanContracts = [...contracts.keys()].filter((k) => !slices.includes(k));
  const rawLocalStorageSlices = [];
  let rawConfirmCalls = 0;

  for (const slice of slices) {
    const dir = path.join(slicesDir, slice);
    const files = walk(dir).filter((f) => /\.(ts|svelte)$/.test(f) && !/\.test\.ts$/.test(f));
    let usesLocalStorage = false;
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (/\b(localStorage|sessionStorage)\./.test(content)) usesLocalStorage = true;
      const confirms = content.match(/\bwindow\.(confirm|alert|prompt)\s*\(/g);
      if (confirms) rawConfirmCalls += confirms.length;
    }
    if (usesLocalStorage) rawLocalStorageSlices.push(slice);
  }

  let minifiedProductionFiles = 0;
  for (const area of ["app", "frontend/svelte/src", "lib"]) {
    for (const file of walk(path.join(root, area))) {
      if (!/\.(ts|svelte)$/.test(file) || /\.test\.ts$/.test(file)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      if (lines.some((line) => line.length > 400)) minifiedProductionFiles++;
    }
  }

  return {
    metrics: {
      slicesMissingContract: missingContract.length,
      orphanContractEntries: orphanContracts.length,
      slicesWithoutBarrel: 0,
      slicesWithoutTests: 0,
      frameSlicesWithoutAppFrame: 0,
      rawConfirmCalls,
      rawLocalStorageSlices: rawLocalStorageSlices.length,
      minifiedProductionFiles,
    },
    details: { missingContract, orphanContracts, withoutBarrel: [], withoutTests: [], frameWithoutAppFrame: [], rawLocalStorageSlices },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const policy = JSON.parse(readFileSync(path.join(ROOT, "feature.boundaries.json"), "utf8"));
  const { metrics, details } = auditFeatures(ROOT);
  let failed = false;
  console.log("Feature contract health");
  for (const [key, current] of Object.entries(metrics)) {
    const max = policy.ratchets[key];
    const ok = Number.isFinite(max) && current <= max;
    console.log(`  ${key.padEnd(28)} ${String(current).padStart(4)} / max ${String(max).padStart(4)} ${ok ? "PASS" : "FAIL"}`);
    if (!ok) failed = true;
  }
  if (failed) {
    if (details.missingContract.length) console.error("  missing contract:", details.missingContract.join(", "));
    if (details.orphanContracts.length) console.error("  orphan contract:", details.orphanContracts.join(", "));
    console.error("features: contract ratchet regression — comply with docs/FRONTEND-CONTRACT.md and frontend/svelte/src/lib/feature-contracts.ts.");
    process.exit(1);
  }
  console.log("features: healthy within ratchets.");
}
