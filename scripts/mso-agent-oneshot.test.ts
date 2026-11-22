import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { oneShotApproves, oneShotHelp, parseOneShot } from "./mso-agent-oneshot.mjs";

describe("MSO Agent one-shot CLI contract", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-oneshot-test-"));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("defaults autonomous runs to read-only approvals", () => {
    expect(parseOneShot(["--oneshot", "inspect health", "--json"])).toEqual({
      prompt: "inspect health",
      json: true,
      approvalScope: "read",
      files: [],
      thinking: false,
    });
    expect(oneShotApproves("read", "read")).toBe(true);
    expect(oneShotApproves("read", "write")).toBe(false);
    expect(oneShotApproves("read", "exec")).toBe(false);
  });

  it("requires an explicit scope before autonomous write/exec calls", () => {
    expect(parseOneShot(["-z", "run fixture", "--approve-scope", "write"])?.approvalScope).toBe("write");
    expect(oneShotApproves("write", "write")).toBe(true);
    expect(oneShotApproves("write", "exec")).toBe(false);
    expect(oneShotApproves("exec", "exec")).toBe(true);
    expect(() => parseOneShot(["-z", "x", "--approve-scope", "root"])).toThrow(/read, write, or exec/);
  });

  it("--file attaches contents with the delimiter and preserves the literal path", () => {
    const filePath = path.join(tmpDir, "sample.txt");
    fs.writeFileSync(filePath, "sample file content");
    const result = parseOneShot(["--oneshot", "do task", "--file", filePath]);
    expect(result).not.toBeNull();
    expect(result!.files).toEqual([filePath]);
    expect(result!.prompt).toBe(`<file path="${filePath}">\nsample file content\n</file>\n\ndo task`);
  });

  it("preserves relative paths literally in the delimiter", () => {
    const result = parseOneShot(["--oneshot", "do task", "--file", "rel/path/to/file.js"], {
      readFileSync: () => "console.log('hi')",
    });
    expect(result!.files).toEqual(["rel/path/to/file.js"]);
    expect(result!.prompt).toBe(`<file path="rel/path/to/file.js">\nconsole.log('hi')\n</file>\n\ndo task`);
  });

  it("two --file flags attach in order", () => {
    const f1 = path.join(tmpDir, "first.txt");
    const f2 = path.join(tmpDir, "second.txt");
    fs.writeFileSync(f1, "first file body");
    fs.writeFileSync(f2, "second file body");
    const result = parseOneShot(["--oneshot", "compare", "--file", f1, "--file", f2]);
    expect(result!.files).toEqual([f1, f2]);
    expect(result!.prompt).toBe(
      `<file path="${f1}">\nfirst file body\n</file>\n\n<file path="${f2}">\nsecond file body\n</file>\n\ncompare`
    );
  });

  it("--file - reads stdin once; a second - throws", () => {
    const result = parseOneShot(["--oneshot", "summarize", "--file", "-"], { stdin: "stdin stream content" });
    expect(result!.files).toEqual(["-"]);
    expect(result!.prompt).toBe(`<file path="-">\nstdin stream content\n</file>\n\nsummarize`);

    expect(() =>
      parseOneShot(["--oneshot", "summarize", "--file", "-", "--file", "-"], { stdin: "stdin stream content" })
    ).toThrow(/stdin/i);
  });

  it("oversized file throws with the file path and the limit in the message", () => {
    const bigFile = path.join(tmpDir, "oversized.txt");
    fs.writeFileSync(bigFile, Buffer.alloc(200_001, "a").toString());
    expect(() => parseOneShot(["--oneshot", "check", "--file", bigFile])).toThrow(
      new RegExp(`${bigFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*200000`)
    );

    const okFile = path.join(tmpDir, "max-size.txt");
    fs.writeFileSync(okFile, Buffer.alloc(200_000, "b").toString());
    expect(() => parseOneShot(["--oneshot", "check", "--file", okFile])).not.toThrow();
  });

  it("missing file throws", () => {
    const missing = path.join(tmpDir, "nonexistent.txt");
    expect(() => parseOneShot(["--oneshot", "check", "--file", missing])).toThrow(`${missing}: no such file`);
  });

  it("--thinking sets thinking=true and leaves prompt untouched", () => {
    const withThinking = parseOneShot(["--oneshot", "plan architecture", "--thinking"]);
    expect(withThinking).not.toBeNull();
    expect(withThinking!.thinking).toBe(true);
    expect(withThinking!.prompt).toBe("plan architecture");

    const withoutThinking = parseOneShot(["--oneshot", "plan architecture"]);
    expect(withoutThinking).not.toBeNull();
    expect(withoutThinking!.thinking).toBe(false);
    expect(withoutThinking!.prompt).toBe("plan architecture");
  });

  it("--file without a value throws", () => {
    expect(() => parseOneShot(["--oneshot", "task", "--file"])).toThrow(/--file requires a path/);
    expect(() => parseOneShot(["--oneshot", "task", "--file", "--thinking"])).toThrow(/--file requires a path/);
    expect(() => parseOneShot(["--oneshot", "task", "--file", "--json"])).toThrow(/--file requires a path/);
  });

  it("enforces maximum cap of 20 files", () => {
    const argv = ["--oneshot", "task"];
    for (let i = 0; i < 21; i++) argv.push("--file", `file${i}.txt`);
    expect(() => parseOneShot(argv, { readFileSync: () => "content" })).toThrow(/maximum of 20 files/);
  });

  it("documents that one-shot uses the autonomous agent loop and documents new flags", () => {
    const help = oneShotHelp();
    expect(help).toContain("same autonomous MSO Agent tool loop");
    expect(help).toContain("Default approval scope is read");
    expect(help).toContain("--file <path>");
    expect(help).toContain("--thinking");
    // Reworded deliberately: the stream reports reasoning TOKENS, not reasoning text,
    // so the help must not promise a reasoning block it cannot produce.
    expect(help).toContain("reports the reasoning TOKENS the provider returned");
    expect(help).not.toContain("include reasoning blocks in the payload/output");
  });
});