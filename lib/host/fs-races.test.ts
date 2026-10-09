import { promises as fs, renameSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy, fileStream, listDir, makeDir, move, readFile, remove, statReadable, writeFile } from "./fs";
import { readFileBytes } from "./fs-read-bytes";
import { streamFileInto, uploadInto } from "./fs-upload";
import { uploadOneGuarded } from "./fs-upload-guarded";
import { zipStream } from "./fs-zip";
let base: string, root: string, ancestor: string, outside: string;
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-fs-race-")));
  root = path.join(base, "root"); ancestor = path.join(root, "dir"); outside = path.join(base, "outside");
  await fs.mkdir(ancestor, {recursive: true}); await fs.mkdir(outside);
  await fs.writeFile(path.join(ancestor, "data.txt"), "authorized");
  await fs.writeFile(path.join(outside, "data.txt"), "outside-private");
  vi.stubEnv("OS_FS_READ_ROOTS", root); vi.stubEnv("OS_FS_WRITE_ROOTS", root);
});
afterEach(async () => {vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(base, {recursive: true, force: true});});
function race(destination = outside) {
  const open = fs.open.bind(fs); let swapped = false;
  vi.spyOn(fs, "open").mockImplementation((...args: Parameters<typeof fs.open>) => {
    if (!swapped && (String(args[0]).startsWith(ancestor) || /^\/proc\/self\/fd\/\d+\/dir$/.test(String(args[0])))) {
      swapped = true; renameSync(ancestor, `${ancestor}-held`); symlinkSync(destination, ancestor, "dir");
    }
    return open(...args);
  });
  return () => expect(swapped).toBe(true);
}
describe("filesystem authorization against ancestor exchange", () => {
  it.each(["text", "bytes", "raw", "write", "mkdir", "delete", "copy", "move", "list", "upload", "guarded"])("keeps outside files private and intact for %s", async (operation) => {
    const swapped = race(), target = path.join(ancestor, "data.txt");
    const run = async () => {
      if (operation === "text") return readFile(target);
      if (operation === "bytes") return readFileBytes(target);
      if (operation === "raw") {const info = await statReadable(target); await info.handle.close(); return;}
      if (operation === "write") return writeFile(target, "overwrite");
      if (operation === "mkdir") return makeDir(path.join(ancestor, "new", "child"));
      if (operation === "delete") return remove(target);
      if (operation === "copy") return copy(target, path.join(root, "copied.txt"));
      if (operation === "move") return move(target, path.join(root, "moved.txt"));
      if (operation === "list") return listDir(ancestor);
      if (operation === "guarded") return uploadOneGuarded({dest: ancestor, filename: "data.txt", data: Buffer.from("overwrite")});
      const result = await uploadInto(ancestor, [{relPath: "data.txt", data: Buffer.from("overwrite")}]);
      if (result.failed.length) throw new Error("upload refused");
    };
    await expect(run()).rejects.toThrow(); swapped();
    expect(await fs.readFile(path.join(outside, "data.txt"), "utf8")).toBe("outside-private");
    expect(await fs.readdir(outside)).toEqual(["data.txt"]);
  });
  it("does not disclose a credential directory exchanged inside an allowed root", async () => {
    const secret = path.join(root, ".env-secrets"); await fs.mkdir(secret); await fs.writeFile(path.join(secret, "data.txt"), "credential");
    race(secret);
    await expect(readFile(path.join(ancestor, "data.txt"))).rejects.toThrow(/credential/);
  });
  it("does not let a replaced configured root grant access to an outside target", async () => {
    renameSync(root, `${root}-held`); symlinkSync(outside, root, "dir");
    await expect(readFile(path.join(root, "data.txt"))).rejects.toThrow(/outside readable roots/);
  });
  it("refuses an archive source exchanged after selection/preflight", async () => {
    const swapped = race();
    await expect(zipStream(root, ["dir"])).rejects.toThrow(); swapped();
    expect(await fs.readFile(path.join(outside, "data.txt"), "utf8")).toBe("outside-private");
  });
  it("streams from the already verified descriptor after the pathname is exchanged", async () => {
    const info = await statReadable(path.join(ancestor, "data.txt"));
    renameSync(ancestor, `${ancestor}-held`); symlinkSync(outside, ancestor, "dir");
    const chunks: Buffer[] = [];
    for await (const chunk of fileStream(info.handle)) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("authorized");
  });
  it("pins an upload destination throughout body consumption and drains the body", async () => {
    async function* body() {
      yield Buffer.from("first");
      renameSync(ancestor, `${ancestor}-held`); symlinkSync(outside, ancestor, "dir");
      yield Buffer.from("second");
    }
    expect(await streamFileInto(ancestor, "new.txt", body())).toBe("ok");
    expect(await fs.readFile(path.join(`${ancestor}-held`, "new.txt"), "utf8")).toBe("firstsecond");
    expect(await fs.readdir(outside)).toEqual(["data.txt"]);
  });
});
