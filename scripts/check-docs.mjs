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

// Tool catalog modules may be split recursively (for example RASMIC workflow
// modules). Start at tools.ts and follow every local tools-* import transitively.
// Any top-level tools-*.ts module that is not reachable is dead/unregistered code
// and fails CI instead of silently escaping the documentation contract.
const toolModuleName = /^tools-[A-Za-z0-9-]+\.ts$/;
const discoveredToolModules = readdirSync(join(ROOT, "lib/mcp"))
  .filter((name) => toolModuleName.test(name))
  .sort();
const reachable = new Set();
const pending = ["tools.ts"];
while (pending.length) {
  const name = pending.pop();
  if (!name || reachable.has(name)) continue;
  reachable.add(name);
  const text = read(`lib/mcp/${name}`);
  for (const match of text.matchAll(/from\s+["']\.\/(tools-[A-Za-z0-9-]+)["']/g)) {
    const child = `${match[1]}.ts`;
    if (!reachable.has(child)) pending.push(child);
  }
}
for (const name of discoveredToolModules) {
  if (!reachable.has(name)) fail.push(`lib/mcp/${name}: tool module exists but is not reachable from lib/mcp/tools.ts`);
}
for (const name of reachable) {
  if (name !== "tools.ts" && !discoveredToolModules.includes(name)) fail.push(`lib/mcp/${name}: imported tool module is missing`);
}
const toolFiles = [...reachable].sort().map((name) => `lib/mcp/${name}`);
const tools = new Map();
for (const file of toolFiles) {
  const text = read(file);
  const matches = text.matchAll(/name:\s*"([^"]+)"[\s\S]*?scope:\s*"(read|write|exec)"/g);
  for (const [, name, scope] of matches) tools.set(name, scope);
}

// App-only MCP bridge tools are intentionally absent from the model/operator action
// catalogs. They must be documented in the MCP App UI guide instead. Keep this list
// tiny and explicit: adding a hidden bridge should be a conscious review decision.
const appOnlyTools = new Set(["workflow_status"]);
const documentedTools = new Map([...tools].filter(([name]) => !appOnlyTools.has(name)));
const appUiDoc = read("docs/integrations/CHATGPT-UI.md");
for (const name of appOnlyTools) {
  if (!tools.has(name)) fail.push(`app-only MCP tool ${name} is no longer in the source catalog`);
  if (!appUiDoc.includes(`\`${name}\``)) fail.push(`docs/integrations/CHATGPT-UI.md: app-only MCP tool ${name} is not documented`);
}

const counts = { read: 0, write: 0, exec: 0 };
for (const scope of documentedTools.values()) counts[scope] += 1;
const marker = `server=${server} version=${version} tools=${documentedTools.size} read=${counts.read} write=${counts.write} exec=${counts.exec}`;
const markerDocs = ["docs/MCP.md", "docs/ARCHITECTURE.md", "CLAUDE.md"];
for (const file of markerDocs) {
  const text = read(file);
  if (!text.includes(`<!-- mcp-toolset: ${marker} -->`)) {
    fail.push(`${file}: MCP marker stale; expected ${marker}`);
  }
}
for (const file of ["docs/MCP.md"]) {
  const text = read(file);
  for (const name of documentedTools.keys()) {
    if (!text.includes(`\`${name}\``)) fail.push(`${file}: MCP tool ${name} is not documented`);
  }
}

// ChatGPT uses a deliberately compact static profile. Parse its SSOT name set
// from tool-contract.ts, then require the ChatGPT guide to match THAT profile
// rather than the full MSO catalog. Project-owned dynamic MCP names never belong
// in this set.
const toolContract = read("lib/mcp/tool-contract.ts");
const profileBlock = /CHATGPT_TOOL_NAMES\s*=\s*new Set\(\[([\s\S]*?)\]\s*as const\)/.exec(toolContract)?.[1] ?? "";
const chatgptNames = [...profileBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
if (!chatgptNames.length) fail.push("could not parse CHATGPT_TOOL_NAMES from lib/mcp/tool-contract.ts");
for (const name of chatgptNames) if (!tools.has(name)) fail.push(`ChatGPT profile references missing MCP tool ${name}`);
const chatgptModelTools = new Map(chatgptNames.filter((name) => !appOnlyTools.has(name)).map((name) => [name, tools.get(name)]));
const chatgptCounts = { read: 0, write: 0, exec: 0 };
for (const scope of chatgptModelTools.values()) if (scope) chatgptCounts[scope] += 1;
const chatgptAppOnly = chatgptNames.filter((name) => appOnlyTools.has(name)).length;
const profileMarker = `server=${server} version=${version} tools=${chatgptModelTools.size} read=${chatgptCounts.read} write=${chatgptCounts.write} exec=${chatgptCounts.exec} app-only=${chatgptAppOnly} total=${chatgptNames.length}`;
const chatgpt = read("docs/CHATGPT-PLUGIN.md");
if (!chatgpt.includes(`<!-- mcp-chatgpt-profile: ${profileMarker} -->`)) fail.push(`docs/CHATGPT-PLUGIN.md: ChatGPT profile marker stale; expected ${profileMarker}`);
for (const name of chatgptModelTools.keys()) if (!chatgpt.includes(`\`${name}\``)) fail.push(`docs/CHATGPT-PLUGIN.md: ChatGPT profile tool ${name} is not documented`);
const scopeOrder = ["read", "write", "exec"];
for (let i = 0; i < scopeOrder.length; i += 1) {
  const scope = scopeOrder[i];
  const next = scopeOrder[i + 1];
  const expected = [...chatgptModelTools].filter(([, value]) => value === scope).map(([name]) => name).sort();
  const heading = scope === "read"
    ? `### \`read\` — ${expected.length} ChatGPT model tools`
    : `### \`${scope}\` — + ${expected.length} ChatGPT model tools`;
  if (!chatgpt.includes(heading)) fail.push(`docs/CHATGPT-PLUGIN.md: stale ${scope} profile heading; expected ${heading}`);
  const start = chatgpt.indexOf(`### \`${scope}\` —`);
  const end = next ? chatgpt.indexOf(`### \`${next}\` —`, start + 1) : chatgpt.indexOf("\n### App-only ChatGPT bridge", start + 1);
  if (start < 0 || end < 0) { fail.push(`docs/CHATGPT-PLUGIN.md: could not parse ${scope} profile block`); continue; }
  const actual = [...chatgpt.slice(start, end).matchAll(/^- \`([^\`]+)\`/gm)].map((match) => match[1]).sort();
  if (actual.join("\n") !== expected.join("\n")) fail.push(`docs/CHATGPT-PLUGIN.md: ${scope} ChatGPT profile list differs from source contract`);
}

// MCP.md's scope table must match source membership exactly.
const mcpDoc = read("docs/MCP.md");
for (const scope of scopeOrder) {
  const expected = [...documentedTools].filter(([, value]) => value === scope).map(([name]) => name).sort();
  const row = mcpDoc.split("\n").find((line) => line.startsWith(`| \`${scope}\` |`));
  if (!row) { fail.push(`docs/MCP.md: missing ${scope} scope row`); continue; }
  const actual = [...row.matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((name) => name !== scope).sort();
  if (actual.join("\n") !== expected.join("\n")) fail.push(`docs/MCP.md: ${scope} scope row differs from source catalog`);
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
console.log(`docs: current — ${markdown.length} markdown files, ${documentedTools.size} model MCP tools + ${appOnlyTools.size} app-only bridge, ${sliceCount} slices, ${featureCount} AppShell feature dirs`);
