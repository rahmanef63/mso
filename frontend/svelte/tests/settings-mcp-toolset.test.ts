import { test } from "node:test";
import assert from "node:assert/strict";
import { readMcpStatus } from "../src/lib/settings/settings-mcp-api.ts";

const signal = new AbortController().signal;
const bridge = { surface: "web" as const, apiBaseOrigin: null };

const respond = (toolset: unknown): typeof fetch => async () =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ enabled: true, maxScope: "read", origin: "", toolset, tokens: [] }),
  }) as Response;

// The backend (`/api/mcp/tokens`) returns `toolset.toolCount` from
// lib/mcp/toolset.ts. Settings used to read only a legacy `count` field, so a
// real 61-tool server rendered "0 tools". Both shapes must resolve.
test("backend toolCount is used when present (real 61-tool server)", async () => {
  const status = await readMcpStatus(signal, respond({ toolCount: 61, version: "v", hash: "h" }), bridge);
  assert.equal(status.toolset.count, 61);
});

test("legacy count is still honored when toolCount is absent", async () => {
  const status = await readMcpStatus(signal, respond({ count: 2 }), bridge);
  assert.equal(status.toolset.count, 2);
});

test("a genuine toolCount of 0 stays 0 instead of falling back to legacy count", async () => {
  const status = await readMcpStatus(signal, respond({ toolCount: 0, count: 2 }), bridge);
  assert.equal(status.toolset.count, 0);
});

test("toolCount wins over a stale legacy count", async () => {
  const status = await readMcpStatus(signal, respond({ toolCount: 61, count: 2 }), bridge);
  assert.equal(status.toolset.count, 61);
});

test("missing or malformed counts render 0 rather than NaN or a string", async () => {
  for (const toolset of [{}, { toolCount: "61" }, { count: null }, null, 5]) {
    const status = await readMcpStatus(signal, respond(toolset), bridge);
    assert.equal(status.toolset.count, 0, `expected 0 for ${JSON.stringify(toolset)}`);
  }
});
