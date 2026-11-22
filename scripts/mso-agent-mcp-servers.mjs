import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { api } from "./mso-agent-api.mjs";

// The pane in scripts/mso-agent-pane-context.mjs expects an array of server objects:
// { name: string, toolCount?: number, tools?: unknown[] | number, connected?: boolean, status?: string, error?: unknown }
// Real sources (API endpoint, .mcp.json, ~/.mso/mcp.json) provide:
// - Object map: { mcpServers: { [name]: { command?, args?, url?, toolCount?, tools? } } }
// - Array: Array<{ name?: string, id?: string, toolCount?: number, tools?: unknown[], ... }>
// This mapping function adapts in ONE place: it converts dictionaries or arrays into the
// array shape expected by the pane. Non-visual fields (command, args, env, url, cwd, headers)
// are dropped. Servers without a tool count are preserved with connected status (not marked offline).
export function mapMcpServers(raw) {
  if (raw == null || typeof raw !== "object") return null;

  let list = null;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (Array.isArray(raw.mcpServers)) {
    list = raw.mcpServers;
  } else if (Array.isArray(raw.servers)) {
    list = raw.servers;
  } else if (raw.mcpServers && typeof raw.mcpServers === "object" && !Array.isArray(raw.mcpServers)) {
    list = Object.entries(raw.mcpServers).map(([name, conf]) => ({
      name,
      ...(conf && typeof conf === "object" ? conf : {}),
    }));
  } else if (raw.servers && typeof raw.servers === "object" && !Array.isArray(raw.servers)) {
    list = Object.entries(raw.servers).map(([name, conf]) => ({
      name,
      ...(conf && typeof conf === "object" ? conf : {}),
    }));
  } else {
    // Avoid mistaking OAuth client storage for server configuration
    const keys = Object.keys(raw);
    const isStoreEnvelope = keys.some((k) => ["clients", "tokens", "codes", "refreshTokens"].includes(k));
    if (isStoreEnvelope) return null;
    list = Object.entries(raw).map(([name, conf]) => ({
      name,
      ...(conf && typeof conf === "object" ? conf : {}),
    }));
  }

  return list.map((server) => {
    const name = String(server?.name || server?.id || "server");
    const item = { name };
    if (typeof server?.toolCount === "number") {
      item.toolCount = server.toolCount;
    } else if (Array.isArray(server?.tools)) {
      item.tools = server.tools;
    } else if (typeof server?.tools === "number") {
      item.tools = server.tools;
    }
    if (typeof server?.connected === "boolean") item.connected = server.connected;
    if (server?.status) item.status = server.status;
    if (server?.state) item.state = server.state;
    if (server?.error) item.error = server.error;
    if (server?.isError) item.isError = server.isError;
    return item;
  });
}

// Fetches or reads MCP server configuration once at startup.
// Never called inside a render function to avoid network/disk overhead during keystroke repaints.
export async function fetchMcpServers(options = {}) {
  const apiFn = options.apiFn || api;

  // 1. Try reading from server API endpoint if available.
  try {
    const data = await apiFn("/api/v1/mcp/server");
    if (data != null) {
      const mapped = mapMcpServers(data);
      if (mapped !== null) return mapped;
    }
  } catch {
    // API endpoint does not exist or server is unreachable; fall through to local files.
  }

  // 2. Try reading from local config files.
  const customFile = options.filePath || process.env.OS_MCP_STORE;
  const candidateFiles = customFile
    ? [customFile]
    : [
        path.join(os.homedir(), ".mso", "mcp.json"),
        path.join(options.cwd || process.cwd(), ".mcp.json"),
      ];

  const readFileFn = options.readFile || fs.readFile;

  for (const filePath of candidateFiles) {
    try {
      const rawText = await readFileFn(filePath, "utf8");
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === "object") {
        if (parsed.mcpServers !== undefined || parsed.servers !== undefined) {
          const mapped = mapMcpServers(parsed);
          if (mapped !== null) return mapped;
        }
      }
    } catch {
      // File missing or unreadable; check next candidate.
    }
  }

  return null;
}
