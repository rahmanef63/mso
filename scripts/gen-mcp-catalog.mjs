#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectMcpCatalog, renderMcpCatalogMarkdown } from "./lib/mcp-catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/generated/MCP-CATALOG.md");
const catalog = collectMcpCatalog(ROOT);
const errors = [
  ...catalog.orphanModules.map((name) => `orphan MCP tool module: lib/mcp/${name}`),
  ...catalog.missingModules.map((name) => `missing MCP tool module: lib/mcp/${name}`),
  ...catalog.profileMissing.map((name) => `ChatGPT profile references missing MCP tool: ${name}`),
];
if (errors.length) { for (const error of errors) console.error(error); process.exit(1); }
const expected = renderMcpCatalogMarkdown(catalog);
if (process.argv.includes("--check")) {
  const actual = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (actual !== expected) { console.error("generated MCP catalog is stale; run: node scripts/gen-mcp-catalog.mjs"); process.exit(1); }
  console.log(`mcp-catalog: current — full ${catalog.transportCount}/${catalog.modelCount}; ChatGPT ${catalog.chatgpt.transportCount}/${catalog.chatgpt.modelCount}`);
  process.exit(0);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, expected);
console.log(`wrote ${OUT}`);
