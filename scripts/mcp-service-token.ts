#!/usr/bin/env bun
import { issueServiceToken } from "../lib/mcp/service-token";
import type { Scope } from "../lib/mcp/scope";

const argv = process.argv.slice(2);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const scopeRaw = value("--scope") ?? "read";
if (scopeRaw !== "read" && scopeRaw !== "write" && scopeRaw !== "exec") throw new Error("--scope must be read, write, or exec");
const tools = (value("--tools") ?? "").split(",").map((row) => row.trim()).filter(Boolean);
let constraints: unknown = undefined;
const rawConstraints=value("--constraints-json");
if(rawConstraints){try{constraints=JSON.parse(rawConstraints)}catch{throw new Error("--constraints-json must be valid JSON")}}
const result = await issueServiceToken({
  label: value("--label") ?? "", clientId: value("--client-id") ?? "", scope: scopeRaw as Scope, allowedTools: tools, constraints,
});
process.stdout.write(JSON.stringify({ accessToken: result.token, tokenType: "Bearer", scope: result.scope, allowedTools: result.allowedTools, toolArgumentConstraints: result.toolArgumentConstraints, expiresAt: result.expiresAt }) + "\n");
