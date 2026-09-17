import { constants, promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listWorkflowFiles, readWorkflowJson, removeWorkflowFile, writeWorkflowFile } from "./private-file";

const roots: string[] = [];
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-workflow-file-")); roots.push(root); return root; }
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe("private workflow file descriptors", () => {
  it("preserves atomic file format, permissions and directory listing", async () => {
    const root = await fixture(), target = path.join(root, "nested", "store.json");
    await writeWorkflowFile(target, '{"value":1}');
    expect(await readWorkflowJson(target, 100, "fixture")).toEqual({ value: 1 });
    await writeWorkflowFile(target, '{"value":2}');
    expect(await readWorkflowJson(target, 100, "fixture")).toEqual({ value: 2 });
    expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
    expect(await listWorkflowFiles(path.dirname(target))).toEqual(["store.json"]);
    await removeWorkflowFile(target);
    await expect(readWorkflowJson(target, 100, "fixture")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses final symlinks, oversized data, public permissions and FIFOs without blocking", async () => {
    const root = await fixture(), target = path.join(root, "store.json"), outside = path.join(root, "outside.json");
    await fs.writeFile(outside, '{"secret":"untouched"}', { mode: 0o600 });
    await fs.symlink(outside, target);
    await expect(readWorkflowJson(target, 100, "fixture")).rejects.toThrow("unsafe fixture");
    await fs.unlink(target);
    await fs.writeFile(target, " ".repeat(1024), { mode: 0o600 });
    await expect(readWorkflowJson(target, 100, "fixture")).rejects.toThrow("unsafe fixture");
    await fs.writeFile(target, "{}"); await fs.chmod(target, 0o644);
    await expect(readWorkflowJson(target, 100, "fixture")).rejects.toThrow("unsafe fixture");
    await fs.unlink(target); execFileSync("mkfifo", ["-m", "600", target]);
    await expect(readWorkflowJson(target, 100, "fixture")).rejects.toThrow("unsafe fixture");
    expect(await fs.readFile(outside, "utf8")).toBe('{"secret":"untouched"}');
  });
  it("rejects a symlinked parent before reads or writes can touch its destination", async () => {
    const root = await fixture(), outside = await fixture(), alias = path.join(root, "alias");
    await fs.symlink(outside, alias);
    await expect(writeWorkflowFile(path.join(alias, "store.json"), "{}")).rejects.toThrow();
    await expect(readWorkflowJson(path.join(alias, "store.json"), 100, "fixture")).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it("does not reopen a pathname after validating a file descriptor", async () => {
    const root = await fixture(), target = path.join(root, "store.json");
    await fs.writeFile(target, '{"value":1}', { mode: 0o600 });
    const namedRead = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("path read forbidden"));
    expect(await readWorkflowJson(target, 100, "fixture")).toEqual({ value: 1 });
    expect(namedRead).not.toHaveBeenCalled();
  });
  it("keeps the validated snapshot readable during a legitimate atomic replacement", async () => {
    const root = await fixture(), target = path.join(root, "store.json");
    await fs.writeFile(target, '{"value":"original"}', { mode: 0o600 });
    const original = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (String(args[0]).endsWith("/store.json") && args[1] === (constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)) {
        const stat = handle.stat.bind(handle); let first = true;
        vi.spyOn(handle, "stat").mockImplementation(async () => {
          const result = await stat();
          if (first) {
            first = false;
            await fs.writeFile(target + ".replacement", '{"value":"replacement"}', { mode: 0o600 });
            await fs.rename(target + ".replacement", target);
          }
          return result;
        });
      }
      return handle;
    });
    expect(await readWorkflowJson(target, 100, "fixture")).toEqual({ value: "original" });
    expect(await fs.readFile(target, "utf8")).toBe('{"value":"replacement"}');
  });
  it("detects file growth after opening without reading an unbounded stream", async () => {
    const root = await fixture(), target = path.join(root, "store.json");
    await fs.writeFile(target, "{}", { mode: 0o600 });
    const original = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await original(...args);
      if (String(args[0]).endsWith("/store.json") && args[1] === (constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)) {
        const stat = handle.stat.bind(handle); let first = true;
        vi.spyOn(handle, "stat").mockImplementation(async () => {
          const result = await stat();
          if (first) { first = false; await fs.appendFile(target, " ".repeat(1024)); }
          return result;
        });
      }
      return handle;
    });
    await expect(readWorkflowJson(target, 100, "fixture")).rejects.toThrow("changed while reading");
  });
});
