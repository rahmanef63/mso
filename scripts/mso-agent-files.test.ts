import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFilesUrl,
  computeRows,
  expandPath,
  formatEntries,
  handleFilesCommand,
} from "./mso-agent-files.mjs";

describe("MSO Agent /files command and layout", () => {
  it("sorts directories before files and suffixes each directory with /", () => {
    const entries = [
      { name: "zebra.txt", kind: "file" },
      { name: "docs", kind: "dir" },
      { name: "apple.js", kind: "file" },
      { name: "src", kind: "dir" },
    ];
    const lines = formatEntries(entries, { columns: 80, rows: 60 });
    const content = lines.slice(1);
    expect(content[0]).toContain("docs/");
    expect(content[1]).toContain("src/");
    expect(content[2]).toContain("apple.js");
    expect(content[3]).toContain("zebra.txt");
    expect(content[2]).not.toContain("apple.js/");
  });

  it("marks symlinks so they are distinguishable from regular files", () => {
    const entries = [
      { name: "regular.txt", kind: "file" },
      { name: "linked-file.txt", kind: "file", type: "symlink" },
      { name: "link-by-kind", kind: "symlink" },
      { name: "link-dir", kind: "dir", isSymbolicLink: true },
      { name: "pipe", type: "fifo" },
    ];
    const lines = formatEntries(entries, { columns: 80, rows: 60 });
    const regularLine = lines.find((l) => l.includes("regular.txt"));
    const linkFileLine = lines.find((l) => l.includes("linked-file.txt"));
    const linkKindLine = lines.find((l) => l.includes("link-by-kind"));
    const linkDirLine = lines.find((l) => l.includes("link-dir"));
    const pipeLine = lines.find((l) => l.includes("pipe"));

    expect(regularLine).toBeDefined();
    expect(regularLine).not.toContain("symlink");
    expect(linkFileLine).toContain("(symlink)");
    expect(linkKindLine).toContain("(symlink)");
    expect(linkDirLine).toContain("link-dir/");
    expect(linkDirLine).toContain("(symlink)");
    expect(pipeLine).toContain("(fifo)");
  });

  it("never renders a size number even when the payload has size: 0", () => {
    const entries = [
      { name: "empty.txt", kind: "file", size: 0 },
      { name: "big.bin", kind: "file", size: 1048576 },
      { name: "folder", kind: "dir", size: 0 },
    ];
    const lines = formatEntries(entries, { columns: 80, rows: 60 });
    const sizePattern = /\d+\s*(?:B|KB|MB|GB|bytes)\b/i;
    for (const line of lines) {
      expect(line).not.toMatch(sizePattern);
    }
  });

  it("caps at 60 entries with a … N more line and a header stating the cap", () => {
    const entries = Array.from({ length: 75 }, (_, i) => ({
      name: `file-${String(i).padStart(2, "0")}.txt`,
      kind: "file",
    }));
    const lines = formatEntries(entries, { columns: 80, rows: 60 });
    expect(lines[0]).toMatch(/capped at 60/i);
    expect(lines).toHaveLength(62);
    expect(lines[lines.length - 1]).toContain("… 15 more");
  });

  it("respects terminal-height cap when rows is small", () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      name: `item-${i}.txt`,
      kind: "file",
    }));

    // Bounded by rows parameter.
    const lines = formatEntries(entries, { columns: 80, rows: 10 });
    expect(lines[0]).toMatch(/capped at 10/i);
    expect(lines).toHaveLength(12);
    expect(lines[lines.length - 1]).toContain("… 15 more");

    // computeRows enforces floor at 5 and ceiling at 60.
    expect(computeRows(10)).toBe(5);
    expect(computeRows(18)).toBe(10);
    expect(computeRows(100)).toBe(60);

    const floored = formatEntries(entries, { columns: 80, rows: 2 });
    expect(floored[0]).toMatch(/capped at 5/i);
    expect(floored).toHaveLength(7);
  });

  it("expands ~ to the home directory before the URL is built", () => {
    const home = os.homedir();
    expect(expandPath("~")).toBe(home);
    expect(expandPath("~/work")).toBe(path.join(home, "work"));
    expect(buildFilesUrl("~")).toBe(`/api/v1/fs/list?path=${encodeURIComponent(home)}`);
    expect(buildFilesUrl("~/work")).toBe(`/api/v1/fs/list?path=${encodeURIComponent(path.join(home, "work"))}`);
  });

  it("handles errors from server without throwing", async () => {
    const errors: string[] = [];
    const printErr = (msg: string) => errors.push(msg);
    const apiFn = async () => {
      const err = new Error("outside readable roots");
      err.name = "AgentApiError";
      throw err;
    };

    await expect(handleFilesCommand(["/root/secret"], null, { apiFn, printErr })).resolves.not.toThrow();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("outside readable roots");
  });
});
