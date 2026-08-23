#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// --- MCP toolset: source is authoritative; docs carry a machine-readable marker.
const toolset = read("lib/mcp/toolset.ts");
const server = /MCP_SERVER_VERSION\s*=\s*"([^"]+)"/.exec(toolset)?.[1];
const version = /MCP_TOOLSET_VERSION\s*=\s*"([^"]+)"/.exec(toolset)?.[1];
if (!server || !version) fail.push("could not parse MCP version constants");

const toolFiles = [
  "lib/mcp/tools.ts",
  "lib/mcp/tools-read.ts",
  "lib/mcp/tools-discovery.ts",
  "lib/mcp/tools-learning.ts",
  "lib/mcp/tools-power.ts",
];
const tools = new Map();
for (const file of toolFiles) {
  const text = read(file);
  const matches = text.matchAll(/name:\s*"([^"]+)"[\s\S]*?scope:\s*"(read|write|exec)"/g);
  for (const [, name, scope] of matches) tools.set(name, scope);
}
const counts = { read: 0, write: 0, exec: 0 };
for (const scope of tools.values()) counts[scope] += 1;
const marker = `server=${server} version=${version} tools=${tools.size} read=${counts.read} write=${counts.write} exec=${counts.exec}`;
for (const file of ["docs/MCP.md", "docs/CHATGPT-PLUGIN.md", "docs/CONNECTORS-GATEWAY-INTEGRATION.md"]) {
  const text = read(file);
  if (!text.includes(`<!-- mcp-toolset: ${marker} -->`)) {
    fail.push(`${file}: MCP marker stale; expected ${marker}`);
  }
  for (const name of tools.keys()) {
    if (!text.includes(`\`${name}\``)) fail.push(`${file}: MCP tool ${name} is not documented`);
  }
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
console.log(`docs: current — ${markdown.length} markdown files, ${tools.size} MCP tools, ${sliceCount} slices, ${featureCount} AppShell feature dirs`);
