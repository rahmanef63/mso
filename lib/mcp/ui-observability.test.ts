import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const activityDir = await fs.mkdtemp(path.join(os.homedir(), ".mso-ui-observability-"));
const activityLog = path.join(activityDir, "activity.jsonl");
vi.stubEnv("OS_MCP_ACTIVITY_LOG", activityLog);
vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
vi.stubEnv("OS_MCP_UI_ORIGIN", "");

const { dispatch } = await import("./dispatch");
const { readMcpActivity } = await import("./activity");
const { MCP_APP_MIME_TYPE, MCP_UI_EXTENSION, MSO_NATIVE_UI_PROBE_URI } = await import("./ui-resources");

afterAll(async () => {
  await fs.rm(activityDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("MCP Apps protocol observability", () => {
  it("negotiates UI and records the redacted resource lifecycle", async () => {
    const capability = { mimeTypes: [MCP_APP_MIME_TYPE] };
    const legacy = await dispatch({ id: 90, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: { extensions: { [MCP_UI_EXTENSION]: capability } },
    } }, "read", "mcp:ui-observability");
    expect(legacy.result).toMatchObject({ capabilities: { extensions: { [MCP_UI_EXTENSION]: capability } } });

    const modern = await dispatch({ jsonrpc: "2.0", id: 91, method: "server/discover", params: { _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": { extensions: { [MCP_UI_EXTENSION]: capability } },
    } } }, "read", "mcp:ui-observability");
    expect(modern.result).toMatchObject({ capabilities: { extensions: { [MCP_UI_EXTENSION]: capability } } });

    await dispatch({ id: 2, method: "resources/list" }, "read", "mcp:ui-observability");
    await dispatch({ id: 3, method: "resources/read", params: { uri: MSO_NATIVE_UI_PROBE_URI } }, "read", "mcp:ui-observability");

    let rows = await readMcpActivity(20);
    const complete = () => rows.some((row) => row.tool === "resources.list" && row.state === "completed")
      && rows.some((row) => row.tool === "resources.read" && row.state === "completed");
    for (let attempt = 0; attempt < 30 && !complete(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      rows = await readMcpActivity(20);
    }

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "protocol.initialize", state: "completed", detail: "client-ui=true;server-ui=true" }),
      expect.objectContaining({ tool: "protocol.discover", state: "completed", detail: "client-ui=true;server-ui=true" }),
      expect.objectContaining({ tool: "resources.list", state: "completed", detail: "count=4" }),
      expect.objectContaining({
        tool: "resources.read", state: "completed", target: MSO_NATIVE_UI_PROBE_URI,
        detail: "ui mime=" + MCP_APP_MIME_TYPE,
      }),
    ]));

    const raw = await fs.readFile(activityLog, "utf8");
    expect(raw).not.toContain("MSO NATIVE UI WORKS");
    expect(raw).not.toContain("<main");
  });
});
