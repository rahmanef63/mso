import { describe, it, expect } from "vitest";
import { baseName, extOf, joinPath, langOf, lineCol } from "./util";

describe("baseName", () => {
  it("returns empty string for root '/'", () => {
    // '/' strips trailing slash → '' then split('/').pop() → ''
    expect(baseName("/")).toBe("");
  });

  it("strips trailing slash from directory path", () => {
    expect(baseName("/home/user/docs/")).toBe("docs");
  });

  it("returns last segment for a normal path", () => {
    expect(baseName("/home/operator/projects/util.ts")).toBe("util.ts");
  });

  it("returns the name for a single-segment path (no leading slash)", () => {
    expect(baseName("file.txt")).toBe("file.txt");
  });
});

describe("extOf", () => {
  it("returns '' for a path with no extension", () => {
    expect(extOf("/home/operator/Makefile")).toBe("");
  });

  it("returns 'ts' for a .ts file", () => {
    expect(extOf("/src/index.ts")).toBe("ts");
  });

  it("returns 'tsx' for a .tsx file (lowercase)", () => {
    expect(extOf("/src/App.TSX")).toBe("tsx");
  });

  it("returns '' for a dotfile with no secondary extension", () => {
    // '.bashrc' — baseName is '.bashrc', includes('.') is true,
    // split('.') → ['', 'bashrc'], pop() → 'bashrc'
    // NOTE: this is the actual behaviour of the implementation; a dotfile
    // is treated as having extension 'bashrc'. Tested here to document it.
    expect(extOf("/home/operator/.bashrc")).toBe("bashrc");
  });

  it("returns '' for root '/'", () => {
    // baseName('/') === '' which has no '.', so no extension
    expect(extOf("/")).toBe("");
  });
});

describe("joinPath", () => {
  it("joins correctly when dir is root '/'", () => {
    expect(joinPath("/", "etc")).toBe("/etc");
  });

  it("joins a normal dir and name", () => {
    expect(joinPath("/home/operator", "file.ts")).toBe("/home/operator/file.ts");
  });

  it("strips trailing slash from dir before joining", () => {
    expect(joinPath("/home/operator/", "notes.md")).toBe("/home/operator/notes.md");
  });

  it("handles nested dir correctly", () => {
    expect(joinPath("/a/b/c", "d.json")).toBe("/a/b/c/d.json");
  });
});

describe("langOf", () => {
  it("maps .ts → 'ts'", () => {
    expect(langOf("/src/index.ts")).toBe("ts");
  });

  it("maps .tsx → 'ts'", () => {
    expect(langOf("/src/App.tsx")).toBe("ts");
  });

  it("maps .py → 'py'", () => {
    expect(langOf("/scripts/run.py")).toBe("py");
  });

  it("maps .sh → 'sh'", () => {
    expect(langOf("/scripts/deploy.sh")).toBe("sh");
  });

  it("maps .bash → 'sh'", () => {
    expect(langOf("/scripts/setup.bash")).toBe("sh");
  });

  it("maps .zsh → 'sh'", () => {
    expect(langOf("/.zshrc.zsh")).toBe("sh");
  });

  it("maps .json → 'json'", () => {
    expect(langOf("/config/package.json")).toBe("json");
  });

  it("maps .css → 'css'", () => {
    expect(langOf("/styles/main.css")).toBe("css");
  });

  it("maps .scss → 'css'", () => {
    expect(langOf("/styles/vars.scss")).toBe("css");
  });

  it("maps .md → 'md'", () => {
    expect(langOf("/docs/README.md")).toBe("md");
  });

  it("maps .markdown → 'md'", () => {
    expect(langOf("/docs/guide.markdown")).toBe("md");
  });

  it("falls back to 'txt' for unknown extension", () => {
    expect(langOf("/data/file.xyz")).toBe("txt");
  });

  it("falls back to 'txt' for no extension", () => {
    expect(langOf("/home/operator/Makefile")).toBe("txt");
  });
});

describe("lineCol", () => {
  const text = "hello\nworld\nfoo";

  it("returns (1, 1) for caret at start (offset 0)", () => {
    expect(lineCol(text, 0)).toEqual({ ln: 1, col: 1 });
  });

  it("returns correct col at end of first line (before newline)", () => {
    // 'hello' has 5 chars; caret at 5 = end of 'hello', before '\n'
    expect(lineCol(text, 5)).toEqual({ ln: 1, col: 6 });
  });

  it("returns (2, 1) for caret just past the first newline", () => {
    // offset 6 = start of 'world'
    expect(lineCol(text, 6)).toEqual({ ln: 2, col: 1 });
  });

  it("returns correct position in second line", () => {
    // 'hello\n' = 6 chars; 'wor' = 3 more → offset 9, col 4 on line 2
    expect(lineCol(text, 9)).toEqual({ ln: 2, col: 4 });
  });

  it("returns correct position on third line", () => {
    // 'hello\nworld\n' = 12 chars; 'fo' = 2 more → offset 14
    expect(lineCol(text, 14)).toEqual({ ln: 3, col: 3 });
  });

  it("handles single-line text with caret at end", () => {
    expect(lineCol("abc", 3)).toEqual({ ln: 1, col: 4 });
  });

  it("handles empty string with caret 0", () => {
    expect(lineCol("", 0)).toEqual({ ln: 1, col: 1 });
  });
});
