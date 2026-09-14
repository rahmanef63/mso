import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createMcpFileResource } from "./file-transfer-resource";
import { dispatch } from "./dispatch";

const ROOT = path.join(os.tmpdir(), `mso-mcp-file-resources-${process.pid}`);
beforeEach(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });
afterEach(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("resources/read original-byte file bridge", () => {
  it("returns exact base64 bytes for the owner and denies another principal", async () => {
    const bytes = Buffer.from([0,1,2,3,4,250,251,252]);
    const resource = await createMcpFileResource({ data: bytes, filename: "fixture.zip", mimeType: "application/zip", principal: "alice", sessionId: "session-a", maxReads: 3 });
    const ok = await dispatch({ id: 1, method: "resources/read", params: { uri: resource.uri } }, "read", "actor", { principal: "alice", sessionId: "session-a", toolProfile: "chatgpt" });
    const result = (ok as any).result;
    expect(result.contents[0]).toMatchObject({ uri: resource.uri, mimeType: "application/zip", blob: bytes.toString("base64") });
    const denied = await dispatch({ id: 2, method: "resources/read", params: { uri: resource.uri } }, "read", "actor", { principal: "bob", sessionId: "session-a", toolProfile: "chatgpt" });
    expect((denied as any).error?.message).toMatch(/unknown or expired/i);
    const wrongSession = await dispatch({ id: 3, method: "resources/read", params: { uri: resource.uri } }, "read", "actor", { principal: "alice", sessionId: "session-b", toolProfile: "chatgpt" });
    expect((wrongSession as any).error?.message).toMatch(/unknown or expired/i);
  });
});
