#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildImportGraph, findCycles, rel, walkSource } from "./lib/import-graph.mjs";

const ROOT = pathResolve(fileURLToPath(import.meta.url), "../..");
const policy = JSON.parse(readFileSync(pathResolve(ROOT, "architecture.boundaries.json"), "utf8"));
const { graph, barrel, imports } = buildImportGraph(ROOT);
const cycles = findCycles(graph, barrel), structural = cycles.filter((row) => row.kind === "type");
const domain = (file) => {
  const name = rel(ROOT, file);
  if (name.startsWith("lib/")) return name.split("/").slice(0, 2).join("/");
  if (name.startsWith("frontend/slices/")) return name.split("/").slice(0, 3).join("/");
  return name.split("/")[0];
};
const crossDomain = structural.filter(({ ring }) => new Set(ring.slice(0, -1).map(domain)).size > 1);
const sourceFiles = walkSource(ROOT, ["app", "frontend", "lib", "scripts", "bin"], [".ts", ".tsx", ".mjs", ".js", ".sh"]);
const lineCount = (file) => readFileSync(file, "utf8").split("\n").filter((line) => line.trim() && !line.trim().startsWith("//")).length;
const physicalLines = (file) => readFileSync(file, "utf8").split("\n").length;
const filesOver220 = sourceFiles.filter((file) => physicalLines(file) > 220).length;
const filesOver500 = sourceFiles.filter((file) => physicalLines(file) > 500).length;
const serverFrontendImports = imports.filter((row) => rel(ROOT, row.from).startsWith("lib/") && row.spec.startsWith("@/features/")).length;
const appshellSelfBarrelImports = imports.filter((row) => rel(ROOT, row.from).startsWith("frontend/slices/appshell/") && row.spec === "@/features/appshell").length;
const nonMcpMcpImports = imports.filter((row) => {
  const from = rel(ROOT, row.from);
  return from.startsWith("lib/") && !from.startsWith("lib/mcp/") && row.spec.startsWith("@/lib/mcp/");
}).length;
const legacyWorkflowFacadeImports = imports.filter((row) => {
  const from = rel(ROOT, row.from);
  return row.spec === "@/lib/skills/memory" && from !== "lib/skills/memory-compat.test.ts";
}).length;
const crossProtocol = structural.filter(({ ring }) => {
  const domains = new Set(ring.slice(0, -1).map(domain));
  return domains.has("lib/mcp") && (domains.has("lib/a2a") || domains.has("lib/agent"));
});
const metrics = { structuralCycles: structural.length, crossDomainCycles: crossDomain.length, crossProtocolCycles: crossProtocol.length, filesOver220, filesOver500, serverFrontendImports, appshellSelfBarrelImports, nonMcpMcpImports, legacyWorkflowFacadeImports };
let failed = false;
console.log("Architecture health");
for (const [key, current] of Object.entries(metrics)) {
  const max = policy.ratchets[key];
  const ok = Number.isFinite(max) && current <= max;
  console.log(`  ${key.padEnd(26)} ${String(current).padStart(4)} / max ${String(max).padStart(4)} ${ok ? "PASS" : "FAIL"}`);
  if (!ok) failed = true;
}
const valueCycles = cycles.filter((row) => row.kind === "value").length;
console.log(`  ${"valueCycles".padEnd(26)} ${String(valueCycles).padStart(4)} / max    0 ${valueCycles === 0 ? "PASS" : "FAIL"}`);
if (valueCycles) failed = true;
if (process.argv.includes("--verbose")) {
  for (const row of crossDomain) console.log("\n  [cross-domain] " + row.ring.map((file) => rel(ROOT, file)).join("\n  → "));
}
if (failed) {
  console.error("architecture: ratchet regression — reduce the metric or update the policy only with an explicit architecture decision.");
  process.exit(1);
}
console.log("architecture: healthy within ratchets.");
