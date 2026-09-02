#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { collectMcpCatalog } from "./lib/mcp-catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// --- MCP catalog: one generated SSOT for the full server + compact ChatGPT profile.
const catalog = collectMcpCatalog(ROOT);
for (const name of catalog.orphanModules) fail.push(`lib/mcp/${name}: tool module exists but is not reachable from lib/mcp/tools.ts`);
for (const name of catalog.missingModules) fail.push(`lib/mcp/${name}: imported tool module is missing`);
for (const name of catalog.profileMissing) fail.push(`lib/mcp/tool-contract.ts: ChatGPT profile references missing MCP tool ${name}`);

const appUiDoc = read("docs/integrations/CHATGPT-UI.md");
for (const name of catalog.appOnly) {
  if (!appUiDoc.includes(`\`${name}\``)) fail.push(`docs/integrations/CHATGPT-UI.md: app-only MCP tool ${name} is not documented`);
}

const generated = spawnSync(process.execPath, [join(ROOT, "scripts/gen-mcp-catalog.mjs"), "--check"], { cwd: ROOT, encoding: "utf8" });
if (generated.status !== 0) fail.push((generated.stderr || generated.stdout || "docs/generated/MCP-CATALOG.md is stale").trim());

const catalogRefs = new Map([
  ["docs/MCP.md", "./generated/MCP-CATALOG.md"],
  ["docs/CHATGPT-PLUGIN.md", "./generated/MCP-CATALOG.md"],
  ["docs/ARCHITECTURE.md", "./generated/MCP-CATALOG.md"],
  ["CLAUDE.md", "./docs/generated/MCP-CATALOG.md"],
]);
for (const [file, ref] of catalogRefs) {
  const text = read(file);
  if (!text.includes(ref)) fail.push(`${file}: must reference the generated MCP catalog (${ref})`);
  if (text.includes("<!-- mcp-toolset:") || text.includes("<!-- mcp-chatgpt-profile:"))
    fail.push(`${file}: duplicated MCP catalog marker; keep volatile markers only in docs/generated/MCP-CATALOG.md`);
}

// --- Slice catalog counts.
const dirs = (p) => readdirSync(join(ROOT, p), { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name);
const sliceCount = dirs("frontend/slices").length;
const featureCount = dirs("frontend/slices/appshell/features").length;
const sliceMarker = `<!-- slice-catalog: slices=${sliceCount} appshell-features=${featureCount} -->`;
const sliceDoc = read("docs/SLICE-CATALOG.md");
if (!sliceDoc.includes(sliceMarker)) {
  fail.push(`docs/SLICE-CATALOG.md: count marker stale; expected ${sliceMarker}`);
}
for (const name of dirs("frontend/slices")) {
  if (!sliceDoc.includes(`\`${name}\``)) fail.push(`docs/SLICE-CATALOG.md: slice ${name} is not documented`);
}
for (const name of dirs("frontend/slices/appshell/features")) {
  if (!sliceDoc.includes(`\`${name}\``)) fail.push(`docs/SLICE-CATALOG.md: AppShell feature ${name} is not documented`);
}

// --- Every top-level docs/*.md must be classified in docs/README.md.
const map = read("docs/README.md");
for (const name of readdirSync(join(ROOT, "docs")).filter((x) => x.endsWith(".md"))) {
  if (name === "README.md") continue;
  if (!map.includes(`(${name.startsWith(".") ? name : `./${name}`})`)) {
    fail.push(`docs/README.md: ${name} is not classified`);
  }
}

// --- Relative Markdown links across project-authored docs/skills must resolve.
const markdownRoots = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "CLAUDE.md", "docs", "skills", "claude-skills"];
const markdown = [];
function walk(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return;
  const stat = readdirSafe(full);
  if (stat === null) { if (path.endsWith(".md")) markdown.push(path); return; }
  for (const entry of stat) {
    if (["node_modules", ".git", ".next", "coverage"].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) walk(child);
    else if (entry.isFile() && entry.name.endsWith(".md")) markdown.push(child);
  }
}
function readdirSafe(path) {
  try { return readdirSync(path, { withFileTypes: true }); } catch { return null; }
}
for (const root of markdownRoots) {
  const full = join(ROOT, root);
  if (existsSync(full) && !readdirSafe(full) && root.endsWith(".md")) markdown.push(root);
  else walk(root);
}
const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of [...new Set(markdown)]) {
  const text = read(file);
  for (const m of text.matchAll(linkRe)) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const target = raw.split("#", 1)[0].split("?", 1)[0];
    if (!target) continue;
    if (!existsSync(resolve(ROOT, dirname(file), target))) fail.push(`${file}: broken link ${raw}`);
  }
}

// --- Generated CLI docs must track bin/mso --help.
const cli = spawnSync(process.execPath, [join(ROOT, "scripts/gen-cli-docs.mjs"), "--check"], { cwd: ROOT, encoding: "utf8" });
if (cli.status !== 0) fail.push((cli.stderr || cli.stdout || "docs/CLI.md is stale").trim());

if (fail.length) {
  console.error("documentation check failed:");
  for (const item of fail) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`docs: current — ${markdown.length} markdown files, full ${catalog.modelCount}+${catalog.appOnly.length} app-only MCP tools, ChatGPT ${catalog.chatgpt.modelCount}+${catalog.chatgpt.appOnly.length} app-only, ${sliceCount} slices, ${featureCount} AppShell feature dirs`);
