import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAVIGATE_TOOLS } from "./tools-navigate";
import type { GrepResult, GlobResult } from "@/lib/host/fs-grep";

vi.mock("server-only", () => ({}));

const grepTool = NAVIGATE_TOOLS.find((t) => t.name === "fs_grep")!;
const globTool = NAVIGATE_TOOLS.find((t) => t.name === "fs_glob")!;
const mockContext = { scope: "read" as const };

describe("fs_grep and fs_glob navigation tools", () => {
  let tempBase: string;

  beforeEach(async () => {
    tempBase = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-fs-grep-test-")));
    vi.stubEnv("OS_FS_READ_ROOTS", tempBase);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(tempBase, { recursive: true, force: true });
  });

  it("1. grep finds a symbol across two files and reports correct 1-based lines", async () => {
    const fileA = path.join(tempBase, "alpha.ts");
    const subDir = path.join(tempBase, "nested");
    await fs.mkdir(subDir, { recursive: true });
    const fileB = path.join(subDir, "beta.ts");

    await fs.writeFile(fileA, "first line\nconst SYMBOL_ONE = 1;\nthird line\n", "utf8");
    await fs.writeFile(fileB, "import { SYMBOL_ONE } from './alpha';\nconst val = SYMBOL_ONE;\n", "utf8");

    const res = (await grepTool.run({ pattern: "SYMBOL_ONE", path: tempBase }, mockContext)) as GrepResult;
    expect(res.truncated).toBe(false);
    expect(res.matches.length).toBe(3);

    const matchA = res.matches.filter((m) => m.path === fileA);
    expect(matchA).toHaveLength(1);
    expect(matchA[0].line).toBe(2);
    expect(matchA[0].text).toBe("const SYMBOL_ONE = 1;");

    const matchB = res.matches.filter((m) => m.path === fileB);
    expect(matchB).toHaveLength(2);
    expect(matchB[0].line).toBe(1);
    expect(matchB[1].line).toBe(2);
  });

  it("2. grep respects glob filtering", async () => {
    await fs.writeFile(path.join(tempBase, "code.ts"), "const SHARED_KEY = 100;\n", "utf8");
    await fs.writeFile(path.join(tempBase, "code.js"), "const SHARED_KEY = 100;\n", "utf8");

    const res = (await grepTool.run(
      { pattern: "SHARED_KEY", path: tempBase, glob: "**/*.ts" },
      mockContext,
    )) as GrepResult;

    expect(res.matches.length).toBe(1);
    expect(res.matches[0].path.endsWith("code.ts")).toBe(true);
  });

  it("3. grep skips node_modules even when the pattern matches there", async () => {
    const nodeModulesDir = path.join(tempBase, "node_modules", "some-lib");
    const srcDir = path.join(tempBase, "src");
    await fs.mkdir(nodeModulesDir, { recursive: true });
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(path.join(nodeModulesDir, "index.ts"), "export const SECRET_FN = 1;\n", "utf8");
    await fs.writeFile(path.join(srcDir, "index.ts"), "export const SECRET_FN = 2;\n", "utf8");

    const res = (await grepTool.run({ pattern: "SECRET_FN", path: tempBase }, mockContext)) as GrepResult;
    expect(res.matches.length).toBe(1);
    expect(res.matches[0].path).toBe(path.join(srcDir, "index.ts"));
  });

  it("4. grep skips a file containing a NUL byte in the first 8 KiB", async () => {
    const binaryFile = path.join(tempBase, "blob.bin");
    const textFile = path.join(tempBase, "doc.txt");

    const binBuf = Buffer.concat([Buffer.from("abc\0def"), Buffer.from("MATCH_NUL_TEST")]);
    await fs.writeFile(binaryFile, binBuf);
    await fs.writeFile(textFile, "MATCH_NUL_TEST in plain text\n", "utf8");

    const res = (await grepTool.run({ pattern: "MATCH_NUL_TEST", path: tempBase }, mockContext)) as GrepResult;
    expect(res.matches.length).toBe(1);
    expect(res.matches[0].path).toBe(textFile);
  });

  it("5. grep truncates at max_matches and sets truncated with a reason", async () => {
    const file = path.join(tempBase, "lines.txt");
    const content = ["hit 1", "hit 2", "hit 3", "hit 4"].join("\n");
    await fs.writeFile(file, content, "utf8");

    const res = (await grepTool.run({ pattern: "hit", path: tempBase, max_matches: 2 }, mockContext)) as GrepResult;
    expect(res.truncated).toBe(true);
    expect(res.matches.length).toBe(2);
    expect(res.reason).toContain("max_matches");
  });

  it("6. invalid regex returns an error result, does not throw", async () => {
    const res = (await grepTool.run({ pattern: "[unclosed", path: tempBase }, mockContext)) as GrepResult;
    expect(res).toHaveProperty("error");
    expect(typeof res.error).toBe("string");
    expect(res.matches).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it("7. glob **/*.ts matches nested files but not *.js", async () => {
    const nestedDir = path.join(tempBase, "a", "b");
    await fs.mkdir(nestedDir, { recursive: true });

    await fs.writeFile(path.join(tempBase, "root.ts"), "");
    await fs.writeFile(path.join(nestedDir, "nested.ts"), "");
    await fs.writeFile(path.join(tempBase, "root.js"), "");
    await fs.writeFile(path.join(nestedDir, "nested.js"), "");

    const res = (await globTool.run({ pattern: "**/*.ts", path: tempBase }, mockContext)) as GlobResult;
    expect(res.truncated).toBe(false);
    expect(res.paths.length).toBe(2);
    expect(res.paths[0].endsWith("root.ts") || res.paths[0].endsWith("nested.ts")).toBe(true);
    expect(res.paths.every((p) => p.endsWith(".ts"))).toBe(true);
  });

  it("8. glob truncates at max_results", async () => {
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(path.join(tempBase, `file-${i}.txt`), "");
    }

    const res = (await globTool.run({ pattern: "*.txt", path: tempBase, max_results: 2 }, mockContext)) as GlobResult;
    expect(res.truncated).toBe(true);
    expect(res.paths.length).toBe(2);
    expect(res.reason).toContain("max_results");
  });
});
