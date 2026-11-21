#!/usr/bin/env node
// Automated feature governance validator. Enforces feature.boundaries.json ratchets
// and frontend/slices/feature-contracts.ts coverage across every slice on disk.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "coverage", "svelte"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function parseContractTable(root = ROOT) {
  const contractFile = path.join(root, "frontend/slices/feature-contracts.ts");
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
  const slicesDir = path.join(root, "frontend/slices");
  const slices = readdirSync(slicesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const contracts = parseContractTable(root);

  const missingContract = slices.filter((s) => !contracts.has(s));
  const orphanContracts = [...contracts.keys()].filter((k) => !slices.includes(k));
  const withoutBarrel = [];
  const withoutTests = [];
  const frameWithoutAppFrame = [];
  const rawLocalStorageSlices = [];
  let rawConfirmCalls = 0;

  for (const slice of slices) {
    const dir = path.join(slicesDir, slice);
    const hasBarrel = existsSync(path.join(dir, "index.ts")) || existsSync(path.join(dir, "index.tsx"));
    if (!hasBarrel) withoutBarrel.push(slice);

    const files = walk(dir);
    const tsFiles = files.filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
    const testFiles = files.filter((f) => /\.test\.(ts|tsx)$/.test(f));
    if (testFiles.length === 0) withoutTests.push(slice);

    let usesAppFrame = false;
    let usesLocalStorage = false;
    for (const file of tsFiles) {
      const content = readFileSync(file, "utf8");
      if (/\bAppFrame\b/.test(content)) usesAppFrame = true;
      if (/\b(localStorage|sessionStorage)\./.test(content)) usesLocalStorage = true;
      const confirms = content.match(/\bwindow\.(confirm|alert|prompt)\s*\(/g);
      if (confirms) rawConfirmCalls += confirms.length;
    }

    const contract = contracts.get(slice);
    if (contract?.surfaceKind === "frame" && !usesAppFrame) frameWithoutAppFrame.push(slice);
    if (usesLocalStorage) rawLocalStorageSlices.push(slice);
  }

  let minifiedProductionFiles = 0;
  for (const area of ["app", "frontend/slices", "lib"]) {
    for (const file of walk(path.join(root, area))) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.(ts|tsx)$/.test(file)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      if (lines.some((line) => line.length > 400)) minifiedProductionFiles++;
    }
  }

  return {
    metrics: {
      slicesMissingContract: missingContract.length,
      orphanContractEntries: orphanContracts.length,
      slicesWithoutBarrel: withoutBarrel.length,
      slicesWithoutTests: withoutTests.length,
      frameSlicesWithoutAppFrame: frameWithoutAppFrame.length,
      rawConfirmCalls,
      rawLocalStorageSlices: rawLocalStorageSlices.length,
      minifiedProductionFiles,
    },
    details: { missingContract, orphanContracts, withoutBarrel, withoutTests, frameWithoutAppFrame, rawLocalStorageSlices },
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
    if (details.withoutBarrel.length) console.error("  missing barrel:", details.withoutBarrel.join(", "));
    if (details.withoutTests.length) console.error("  missing unit tests:", details.withoutTests.join(", "));
    if (details.frameWithoutAppFrame.length) console.error("  frame slice without AppFrame:", details.frameWithoutAppFrame.join(", "));
    console.error("features: contract ratchet regression — comply with docs/FRONTEND-CONTRACT.md and frontend/slices/feature-contracts.ts.");
    process.exit(1);
  }
  console.log("features: healthy within ratchets.");
}
