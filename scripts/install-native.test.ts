import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { randomBytes } from "node:crypto";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "mso-native-env-"));
const source = fs.readFileSync("scripts/install-native.mjs", "utf8").replace(/^import .*;\n/gm, "").replaceAll("import.meta.url", "'fixture'");
afterAll(() => { fs.rmSync(base, { recursive: true, force: true }); });
function install(name: string, seed?: (root: string) => void, fileSystem = fs) {
  const root = path.join(base, name); fs.mkdirSync(path.join(root, ".git"), { recursive: true }); seed?.(root);
  vm.runInNewContext(source, { fs: fileSystem, os: { homedir: () => root }, path, randomBytes,
    fileURLToPath: () => path.join(root, "scripts/install-native.mjs"),
    process: { platform: "darwin", versions: { node: "22.12.0" }, execPath: "node", env: { CI: "true" }, stdout: { write() {} }, stderr: { write() {} }, exit() { throw new Error("install refused"); } },
    spawnSync: (_program: string, args: string[]) => ({ status: 0, stdout: args[0] === "remote" ? "https://github.com/rahmanef63/mso.git" : "" }),
  });
  return path.join(root, ".env.local");
}
describe("native installer atomic private environment creation", () => {
  it("creates a private file and preserves an existing environment", () => {
    const file = install("fresh");
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      expect(fs.fstatSync(fd).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(fd, "utf8")).toContain("OS_SESSION_SECRET=");
    } finally { fs.closeSync(fd); }
    const existing = install("existing", root => fs.writeFileSync(path.join(root, ".env.local"), "keep"));
    expect(fs.readFileSync(existing, "utf8")).toBe("keep");
  });
  it("refuses a symlink inserted immediately before exclusive creation", () => {
    const target = path.join(base, "outside"); fs.writeFileSync(target, "keep");
    let attempted = false;
    const guardedFs = { ...fs, openSync(file: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null) {
      attempted = true; fs.symlinkSync(target, file); return fs.openSync(file, flags, mode);
    } };
    expect(() => install("raced", undefined, guardedFs)).toThrow("install refused");
    expect(attempted).toBe(true); expect(fs.readFileSync(target, "utf8")).toBe("keep");
  });
});
