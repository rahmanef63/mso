import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(__dirname, "provision-forge-sandbox.sh"), "utf8");

describe("portable Forge sandbox library discovery", () => {
  it("makes the imported root traversable without granting write access", () => {
    expect(source).toContain('chmod 0755 "$ROOT"');
  });

  it("uses POSIX whitespace syntax rather than a GNU-only awk extension", () => {
    expect(source).toContain("[[:space:]]");
    expect(source).not.toContain("\\s*");
  });

  it("includes the ELF interpreter from tab/space-prefixed ldd output", () => {
    const program = source.match(/\| awk '([^']+)'/)?.[1];
    expect(program).toBeTruthy();
    const result = spawnSync("awk", [program!], {
      encoding: "utf8",
      input: "\tlinux-vdso.so.1 (0x1234)\n\tlibc.so.6 => /lib/libc.so.6 (0x1234)\n\t/lib64/ld-linux-x86-64.so.2 (0x1234)\n  /lib/ld-musl-aarch64.so.1 (0x1234)\n",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "/lib/libc.so.6",
      "/lib64/ld-linux-x86-64.so.2",
      "/lib/ld-musl-aarch64.so.1",
    ]);
  });
});
