import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import type { Scope } from "@/lib/capabilities/scope";
import { EDIT_TOOLS } from "./tools-edit";
import { READ_TOOLS } from "./tools-read";
import { sha256Text } from "@/lib/host/fs-api";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/host/audit-api", async (original) => {
  const actual = (await original()) as typeof import("@/lib/host/audit-api");
  return { ...actual, audit: vi.fn(async () => {}) };
});
vi.mock("@/lib/agent/session-store", async (original) => {
  const actual = (await original()) as typeof import("@/lib/agent/session-store");
  return { ...actual, maybeAutoTitleAgentSession: vi.fn(async () => {}), appendAgentSessionEvent: vi.fn(async () => {}) };
});

const { executeCapabilityCall } = await import("@/lib/capabilities/execute");

const edit = EDIT_TOOLS.find((tool) => tool.name === "fs_edit")!;
const read = READ_TOOLS.find((tool) => tool.name === "fs_read")!;
const actor = "mcp:fs-edit-test";
const owner = { principal: "test-client", sessionId: "session-edit" };

const call = (tool: CapabilityTool, args: Record<string, unknown>, scope: Scope = "write", context = owner) =>
  executeCapabilityCall({ tool, args, scope, actor, context });

describe("fs_edit tool", () => {
  let base: string;
  let filePath: string;

  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-fs-edit-test-")));
    filePath = path.join(base, "sample.txt");
    vi.stubEnv("OS_FS_READ_ROOTS", base);
    vi.stubEnv("OS_FS_WRITE_ROOTS", base);
    vi.stubEnv("OS_MCP_ACTIVITY_LOG", "");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(base, { recursive: true, force: true });
  });

  it("1. unique match replaces exactly once and returns the new sha256 that fs_read would compute", async () => {
    const original = "Hello World\nLine 2\nLine 3\n";
    await fs.writeFile(filePath, original, "utf8");

    const res = await call(edit, { path: filePath, old_string: "World", new_string: "MSO" });
    expect(res).toMatchObject({
      kind: "success",
      result: { ok: true, path: filePath, replacements: 1 },
    });

    const expectedContent = "Hello MSO\nLine 2\nLine 3\n";
    const readResult = await call(read, { path: filePath }, "read");
    expect(readResult).toMatchObject({
      kind: "success",
      result: { content: expectedContent, sha256: sha256Text(expectedContent) },
    });

    const editOutput = (res as { result: { sha256: string; bytes: number } }).result;
    expect(editOutput.sha256).toBe(sha256Text(expectedContent));
    expect(editOutput.bytes).toBe(Buffer.byteLength(expectedContent, "utf8"));
  });

  it("2. two matches without replace_all FAILS and leaves the file byte-identical", async () => {
    const original = "foo bar foo baz\n";
    await fs.writeFile(filePath, original, "utf8");

    const res = await call(edit, { path: filePath, old_string: "foo", new_string: "qux" });
    expect(res).toMatchObject({
      kind: "error",
      message: expect.stringMatching(/Found 2 occurrences of old_string.*Pass more surrounding context or set replace_all/i),
    });

    const onDisk = await fs.readFile(filePath, "utf8");
    expect(onDisk).toBe(original);
  });

  it("3. two matches with replace_all: true replaces both", async () => {
    const original = "apple orange apple pear\n";
    await fs.writeFile(filePath, original, "utf8");

    const res = await call(edit, {
      path: filePath,
      old_string: "apple",
      new_string: "grape",
      replace_all: true,
    });

    const expected = "grape orange grape pear\n";
    expect(res).toMatchObject({
      kind: "success",
      result: { ok: true, path: filePath, replacements: 2, sha256: sha256Text(expected) },
    });

    const onDisk = await fs.readFile(filePath, "utf8");
    expect(onDisk).toBe(expected);
  });

  it("4. zero matches FAILS, file unchanged", async () => {
    const original = "first line\nsecond line\n";
    await fs.writeFile(filePath, original, "utf8");

    const res = await call(edit, { path: filePath, old_string: "third line", new_string: "replacement" });
    expect(res).toMatchObject({
      kind: "error",
      message: expect.stringMatching(/old_string not found/i),
    });

    const onDisk = await fs.readFile(filePath, "utf8");
    expect(onDisk).toBe(original);
  });

  it("5. empty old_string FAILS", async () => {
    const original = "hello world\n";
    await fs.writeFile(filePath, original, "utf8");

    const res = await call(edit, { path: filePath, old_string: "", new_string: "something" });
    expect(res).toMatchObject({
      kind: "error",
      message: expect.stringMatching(/must be a non-empty string|old_string must not be empty/i),
    });

    const onDisk = await fs.readFile(filePath, "utf8");
    expect(onDisk).toBe(original);
  });

  it("6. stale expected_sha256 FAILS and does not write", async () => {
    const original = "current file contents\n";
    await fs.writeFile(filePath, original, "utf8");

    const staleHash = "0000000000000000000000000000000000000000000000000000000000000000";
    const res = await call(edit, {
      path: filePath,
      old_string: "current",
      new_string: "modified",
      expected_sha256: staleHash,
    });

    expect(res).toMatchObject({
      kind: "error",
      message: expect.stringMatching(/File changed since fs_read/i),
    });

    const onDisk = await fs.readFile(filePath, "utf8");
    expect(onDisk).toBe(original);
  });

  it("7. correct expected_sha256 succeeds", async () => {
    const original = "version 1.0\nstable\n";
    await fs.writeFile(filePath, original, "utf8");
    const currentHash = sha256Text(original);

    const res = await call(edit, {
      path: filePath,
      old_string: "version 1.0",
      new_string: "version 2.0",
      expected_sha256: currentHash,
    });

    const expected = "version 2.0\nstable\n";
    expect(res).toMatchObject({
      kind: "success",
      result: {
        ok: true,
        path: filePath,
        replacements: 1,
        sha256: sha256Text(expected),
        previousSha256: currentHash,
      },
    });

    const onDisk = await fs.readFile(filePath, "utf8");
    expect(onDisk).toBe(expected);
  });

  it("8. a path outside the write roots is refused (whatever refusal the existing guard produces)", async () => {
    const outsidePath = "/etc/hosts";
    const res = await call(edit, { path: outsidePath, old_string: "localhost", new_string: "remotehost" });
    expect(res).toMatchObject({
      kind: "error",
      message: expect.stringMatching(/outside writable roots|outside readable roots/i),
    });
  });
});
