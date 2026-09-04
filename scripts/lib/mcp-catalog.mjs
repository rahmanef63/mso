import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const APP_ONLY_MCP_TOOLS = new Set(["workflow_status", "render_mso_surface"]);
const TOOL_MODULE_NAME = /^tools-[A-Za-z0-9-]+\.ts$/;
const SCOPES = ["read", "write", "exec"];

const splitByScope = (rows) => {
  const byScope = { read: [], write: [], exec: [] };
  for (const [name, scope] of rows) byScope[scope].push(name);
  for (const scope of SCOPES) byScope[scope].sort();
  return byScope;
};
const countsFor = (byScope) => Object.fromEntries(SCOPES.map((scope) => [scope, byScope[scope].length]));

export function collectMcpCatalog(root) {
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const toolset = read("lib/mcp/toolset.ts");
  const serverVersion = /MCP_SERVER_VERSION\s*=\s*"([^"]+)"/.exec(toolset)?.[1];
  const version = /MCP_TOOLSET_VERSION\s*=\s*"([^"]+)"/.exec(toolset)?.[1];
  const changedAt = /MCP_TOOLSET_CHANGED_AT\s*=\s*"([^"]+)"/.exec(toolset)?.[1];
  if (!serverVersion || !version || !changedAt) throw new Error("could not parse MCP toolset constants");

  const discoveredModules = readdirSync(join(root, "lib/mcp")).filter((name) => TOOL_MODULE_NAME.test(name)).sort();
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
  const orphanModules = discoveredModules.filter((name) => !reachable.has(name));
  const missingModules = [...reachable].filter((name) => name !== "tools.ts" && !discoveredModules.includes(name));

  const all = new Map();
  for (const file of [...reachable].sort().map((name) => `lib/mcp/${name}`)) {
    const text = read(file);
    for (const match of text.matchAll(/name:\s*"([^"]+)"[\s\S]*?scope:\s*"(read|write|exec)"/g)) all.set(match[1], match[2]);
  }

  const appOnly = [...APP_ONLY_MCP_TOOLS].filter((name) => all.has(name)).sort();
  const model = [...all].filter(([name]) => !APP_ONLY_MCP_TOOLS.has(name));
  const byScope = splitByScope(model);

  const toolContract = read("lib/mcp/tool-contract.ts");
  const profileBlock = /CHATGPT_TOOL_NAMES\s*=\s*new Set\(\[([\s\S]*?)\]\s*as const\)/.exec(toolContract)?.[1] ?? "";
  const chatgptNames = [...profileBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const profileMissing = chatgptNames.filter((name) => !all.has(name));
  const chatgptAppOnly = chatgptNames.filter((name) => APP_ONLY_MCP_TOOLS.has(name) && all.has(name)).sort();
  const chatgptModel = chatgptNames.filter((name) => !APP_ONLY_MCP_TOOLS.has(name) && all.has(name)).map((name) => [name, all.get(name)]);
  const chatgptByScope = splitByScope(chatgptModel);

  return {
    serverVersion, version, changedAt, all, model, byScope, appOnly,
    transportCount: all.size,
    modelCount: model.length,
    counts: countsFor(byScope),
    chatgpt: {
      names: chatgptNames,
      model: chatgptModel,
      byScope: chatgptByScope,
      appOnly: chatgptAppOnly,
      transportCount: chatgptNames.filter((name) => all.has(name)).length,
      modelCount: chatgptModel.length,
      counts: countsFor(chatgptByScope),
    },
    orphanModules, missingModules, profileMissing,
  };
}

export function renderMcpCatalogMarkdown(catalog) {
  const list = (rows) => rows.map((name) => `- \`${name}\``).join("\n") || "- none";
  const c = catalog.chatgpt;
  return `# Generated MCP catalog

> **Generated file — do not edit manually.** Source of truth: \`lib/mcp/tools.ts\`, its registered \`tools-*\` modules, \`lib/mcp/toolset.ts\`, and the compact ChatGPT name set in \`lib/mcp/tool-contract.ts\`. Regenerate with \`node scripts/gen-mcp-catalog.mjs\`. The live deployed authority remains \`GET /mcp\`.

## Full MSO catalog

<!-- mcp-toolset: server=${catalog.serverVersion} version=${catalog.version} tools=${catalog.modelCount} read=${catalog.counts.read} write=${catalog.counts.write} exec=${catalog.counts.exec} -->

| Fact | Current source value |
|---|---:|
| MCP server | \`${catalog.serverVersion}\` |
| Toolset | \`${catalog.version}\` |
| Toolset changed at | \`${catalog.changedAt}\` |
| Transport tools | **${catalog.transportCount}** |
| Model/operator tools | **${catalog.modelCount}** |
| Read | **${catalog.counts.read}** |
| Write | **${catalog.counts.write}** |
| Exec | **${catalog.counts.exec}** |
| App-only bridges | **${catalog.appOnly.length}** |

### Read (${catalog.counts.read})

${list(catalog.byScope.read)}

### Write (${catalog.counts.write})

${list(catalog.byScope.write)}

### Exec (${catalog.counts.exec})

${list(catalog.byScope.exec)}

### App-only bridges (${catalog.appOnly.length})

${list(catalog.appOnly)}

## ChatGPT static profile

<!-- mcp-chatgpt-profile: server=${catalog.serverVersion} version=${catalog.version} tools=${c.modelCount} read=${c.counts.read} write=${c.counts.write} exec=${c.counts.exec} app-only=${c.appOnly.length} total=${c.transportCount} -->

The ChatGPT profile is a fail-closed static projection defined by \`CHATGPT_TOOL_NAMES\`. OAuth scope is still enforced independently; project-owned MCP tool names remain dynamic data behind the generic project bridge.

| Fact | Current source value |
|---|---:|
| ChatGPT transport tools | **${c.transportCount}** |
| ChatGPT model/operator tools | **${c.modelCount}** |
| Read | **${c.counts.read}** |
| Write | **${c.counts.write}** |
| Exec | **${c.counts.exec}** |
| App-only bridges | **${c.appOnly.length}** |

### ChatGPT read (${c.counts.read})

${list(c.byScope.read)}

### ChatGPT write (${c.counts.write})

${list(c.byScope.write)}

### ChatGPT exec (${c.counts.exec})

${list(c.byScope.exec)}

### ChatGPT app-only bridges (${c.appOnly.length})

${list(c.appOnly)}
`;
}
