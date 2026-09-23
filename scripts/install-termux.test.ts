import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const installer = path.resolve("scripts/install-termux.sh");
const roots: string[] = [];
const systemPath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-termux-isolation-")); roots.push(root);
  const prefix = path.join(root, "com.termux/files/usr");
  fs.mkdirSync(path.join(prefix, "bin"), { recursive: true });
  const poison = path.join(root, "poison.sh");
  fs.writeFileSync(poison, "echo HOST_STARTUP_LEAK >&2; exit 91\n");
  for (const name of ["node", "bun"]) fs.writeFileSync(path.join(prefix, "bin", name), "#!/bin/sh\necho android\n", { mode: 0o755 });
  const legacyTarget = path.join(root, "legacy-native-mso");
  fs.writeFileSync(legacyTarget, "LEGACY_NATIVE_TARGET\n");
  fs.symlinkSync(legacyTarget, path.join(prefix, "bin/mso"));
  // No packages, downloads, user creation or real PRoot operations are performed.
  // Capture the real installer argv, including its generated launcher heredoc.
  const mock = `
apt() { :; }
curl() { :; }
proot-distro() {
  local arg user=root
  for arg in "$@"; do [ "$arg" != --user ] || user=owner; done
  while [ "$#" -gt 0 ] && [ "$1" != -- ]; do shift; done
  [ "$#" -gt 0 ] || return 0
  shift
  [ "$1" != /bin/true ] || return 0
  printf '%s\\0' "$@" > ${quote(root)}/"$user.args"
}
`;
  const env: NodeJS.ProcessEnv = { PATH: `/usr/bin:/bin`, HOME: root, PREFIX: prefix, TERM: "xterm-256color", NODE_ENV: "test", MSO_TERMUX_NO_TEE: "1" };
  const run = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `${mock}\nsource ${quote(installer)}`], { env, encoding: "utf8", timeout: 10000 });
  expect(run.status, run.stderr).toBe(0);
  const readArgs = (name: string) => fs.readFileSync(path.join(root, `${name}.args`), "utf8").split("\0").slice(0, -1);
  const dirty = {
    ...env, PATH: `${prefix}/bin:/usr/bin:/bin`, BUN_INSTALL: `${prefix}/bun`,
    TERMUX_VERSION: "test", NODE_PATH: `${prefix}/node_modules`, NODE_OPTIONS: "--require=/android-only.js",
    npm_config_nodedir: prefix, npm_config_prefix: prefix, LD_LIBRARY_PATH: `${prefix}/lib`,
    LD_PRELOAD: `${prefix}/lib/nonexistent-test-preload.so`, CFLAGS: "-I/android", LDFLAGS: "-L/android",
    BASH_ENV: poison, ENV: poison, "BASH_FUNC_node%%": "() { echo android; }",
  };
  return { root, prefix, legacyTarget, mock, env, dirty, readArgs, launcher: path.join(prefix, "bin/mso") };
}
function probe(args: string[], env: NodeJS.ProcessEnv) {
  const copy = [...args], body = copy.indexOf("-c") + 1;
  expect(body).toBeGreaterThan(0);
  // Execute the exact clean boundary, but never execute privileged guest setup.
  copy[body] = 'printf "PATH=%s\\nHOME=%s\\nBUN_INSTALL=%s\\n" "$PATH" "$HOME" "${BUN_INSTALL:-}"; /usr/bin/env; type -t node; type -t bun; :';
  return spawnSync(copy[0], copy.slice(1), { env, encoding: "utf8", timeout: 10000 });
}

describe("Termux PRoot Linux environment boundary", () => {
  it("keeps the adapter executable and valid Bash", () => {
    expect(fs.statSync(installer).mode & 0o111).toBe(0o111);
    const result = spawnSync("/bin/bash", ["-n", installer], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
  it("clears Android PATH, Node/Bun configuration, loader flags and shell startup hooks before either guest shell", () => {
    const f = fixture();
    for (const name of ["root", "owner"]) {
      const args = f.readArgs(name);
      expect(args.slice(0, 2)).toEqual(["/usr/bin/env", "-i"]);
      expect(args.slice(args.indexOf("/bin/bash"), args.indexOf("-c") + 1)).toEqual(["/bin/bash", "--noprofile", "--norc", "-c"]);
      const result = probe(args, f.dirty);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(f.prefix);
      expect(result.stdout).not.toMatch(/TERMUX_VERSION=|NODE_PATH=|npm_config_nodedir=|npm_config_prefix=|LD_PRELOAD=|LD_LIBRARY_PATH=|CFLAGS=|LDFLAGS=|BASH_ENV=|ENV=|BASH_FUNC_|function/);
      expect(result.stderr).not.toContain("HOST_STARTUP_LEAK");
      expect(result.stdout).toContain(`PATH=${name === "root" ? "" : "/home/mso/.local/bin:/home/mso/.bun/bin:"}${systemPath}\n`);
      expect(result.stdout).toContain(`HOME=${name === "root" ? "/root" : "/home/mso"}\n`);
      if (name === "owner") expect(result.stdout).toContain("BUN_INSTALL=/home/mso/.bun\n");
    }
  });
  it("generates a syntax-valid launcher with the same clean boundary and lossless argument forwarding", () => {
    const f = fixture();
    expect(fs.readFileSync(f.legacyTarget, "utf8")).toBe("LEGACY_NATIVE_TARGET\n");
    expect(spawnSync("/bin/bash", ["-n", f.launcher]).status).toBe(0);
    // exec cannot call the shell mock; a test-only copy removes just that exec.
    const source = fs.readFileSync(f.launcher, "utf8").replace("exec proot-distro", "proot-distro");
    const argv = ["web", "two words", "", "$(touch NOT_EXECUTED)", "a'b"];
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `${f.mock}\n${source}`, "bash", ...argv], { env: f.env, encoding: "utf8", timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    const args = f.readArgs("owner");
    expect(args.slice(-argv.length)).toEqual(argv);
    expect(args[args.indexOf("-c") + 1]).toBe('cd "$HOME"; exec mso "$@"');
    const checked = probe(args, f.dirty);
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain(`PATH=/home/mso/.local/bin:/home/mso/.bun/bin:${systemPath}\n`);
    expect(checked.stdout).toContain("BUN_INSTALL=/home/mso/.bun\n");
    expect(checked.stdout).not.toContain(f.prefix);
    expect(checked.stdout).not.toMatch(/NODE_OPTIONS=|npm_config_|BASH_ENV=|TERMUX_VERSION=|LD_PRELOAD=/);
    expect(checked.stderr).not.toContain("HOST_STARTUP_LEAK");
  });
  it.each(["node", "bun"])("rejects a guest-visible Android %s before downloading the installer", (android) => {
    const f = fixture(), bin = path.join(f.root, "guest-bin"); fs.mkdirSync(bin);
    for (const runtime of ["node", "bun"]) fs.writeFileSync(path.join(bin, runtime), `#!/bin/sh\necho ${runtime === android ? "android" : "linux"}\n`, { mode: 0o755 });
    const args = f.readArgs("owner"), body = args[args.indexOf("-c") + 1];
    const guard = body.slice(0, body.indexOf('  curl -fsSL "$1"'));
    expect(guard).toContain('for runtime in node bun; do');
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `${guard}\necho DOWNLOAD_REACHED`], { env: { HOME: f.root, PATH: `${bin}:/usr/bin:/bin`, NODE_ENV: "test" }, encoding: "utf8", timeout: 10000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Non-Linux ${android}`);
    expect(result.stdout).not.toContain("DOWNLOAD_REACHED");
    expect(body).toContain('[ "$(node -p "process.platform")" = linux ]');
    expect(body).toContain('[ "$(bun -p "process.platform")" = linux ]');
  });
});
