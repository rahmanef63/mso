import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-guarded-upload-")));
  vi.stubEnv("OS_FS_WRITE_ROOTS", dir);
  vi.stubEnv("OS_FS_READ_ROOTS", dir);
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); });

describe("uploadOneGuarded", () => {
  it("creates, then treats identical bytes as idempotent unchanged", async () => {
    const { uploadOneGuarded } = await import("./fs-upload-guarded");
    const data = Buffer.from("same");
    expect(await uploadOneGuarded({ dest: dir, filename: "a.json", data })).toMatchObject({ status: "created" });
    expect(await uploadOneGuarded({ dest: dir, filename: "a.json", data })).toMatchObject({ status: "unchanged" });
  });
  it("refuses different existing bytes by default", async () => {
    const { uploadOneGuarded } = await import("./fs-upload-guarded");
    await fs.writeFile(path.join(dir, "a.json"), "old");
    await expect(uploadOneGuarded({ dest: dir, filename: "a.json", data: Buffer.from("new") })).rejects.toThrow(/already exists/i);
  });
  it("renames deterministically and is idempotent on retry", async () => {
    const { uploadOneGuarded } = await import("./fs-upload-guarded");
    await fs.writeFile(path.join(dir, "a.json"), "old");
    const first = await uploadOneGuarded({ dest: dir, filename: "a.json", data: Buffer.from("new"), conflict: "rename" });
    const second = await uploadOneGuarded({ dest: dir, filename: "a.json", data: Buffer.from("new"), conflict: "rename" });
    expect(first.status).toBe("renamed");
    expect(first.filename).toMatch(/^a\.[a-f0-9]{16}\.json$/);
    expect(second).toMatchObject({ status: "unchanged", filename: first.filename });
  });
  it("requires the exact prior hash for replacement", async () => {
    const { uploadOneGuarded } = await import("./fs-upload-guarded");
    const file = path.join(dir, "a.json");
    await fs.writeFile(file, "old");
    const oldHash = createHash("sha256").update("old").digest("hex");
    await expect(uploadOneGuarded({ dest: dir, filename: "a.json", data: Buffer.from("new"), conflict: "replace" })).rejects.toThrow(/expected_sha256/i);
    await expect(uploadOneGuarded({ dest: dir, filename: "a.json", data: Buffer.from("new"), conflict: "replace", expectedSha256: "0".repeat(64) })).rejects.toThrow(/changed/i);
    const replaced = await uploadOneGuarded({ dest: dir, filename: "a.json", data: Buffer.from("new"), conflict: "replace", expectedSha256: oldHash });
    expect(replaced.status).toBe("replaced");
    expect(await fs.readFile(file, "utf8")).toBe("new");
    expect(await uploadOneGuarded({ dest: dir, filename: "a.json", data: Buffer.from("new"), conflict: "replace", expectedSha256: oldHash })).toMatchObject({ status: "unchanged" });
  });
  it("does not create a missing destination in replace mode", async () => {
    const { uploadOneGuarded } = await import("./fs-upload-guarded");
    await expect(uploadOneGuarded({ dest: dir, filename: "a.json", data: Buffer.from("new"), conflict: "replace", expectedSha256: "0".repeat(64) })).rejects.toThrow(/existing destination/i);
  });
});
