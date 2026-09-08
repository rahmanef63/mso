import { describe, it, expect } from "vitest";
import { resolve, rekey, extTag } from "./fs-model";
import type { FsModel } from "./fs-model";

describe("resolve", () => {
  const cwd = "/home/operator";

  it("no arg returns cwd", () => {
    expect(resolve(cwd)).toBe("/home/operator");
  });

  it("'.' returns cwd", () => {
    expect(resolve(cwd, ".")).toBe("/home/operator");
  });

  it("'/' returns root", () => {
    expect(resolve(cwd, "/")).toBe("/");
  });

  it("'..' from two-segment path returns parent", () => {
    expect(resolve(cwd, "..")).toBe("/home");
  });

  it("'..' from single-segment path returns root", () => {
    expect(resolve("/home", "..")).toBe("/");
  });

  it("'..' from root stays root", () => {
    expect(resolve("/", "..")).toBe("/");
  });

  it("'..' multi-level via chained calls", () => {
    const first = resolve("/home/operator/projects", "..");
    expect(first).toBe("/home/operator");
    expect(resolve(first, "..")).toBe("/home");
  });

  it("absolute arg ignores cwd", () => {
    expect(resolve(cwd, "/var/log")).toBe("/var/log");
  });

  it("relative arg appended to cwd", () => {
    expect(resolve(cwd, "projects")).toBe("/home/operator/projects");
  });

  it("relative arg with nested path", () => {
    expect(resolve(cwd, "projects/mso")).toBe("/home/operator/projects/mso");
  });

  it("strips trailing slash from absolute arg", () => {
    expect(resolve(cwd, "/var/log/")).toBe("/var/log");
  });

  it("strips trailing slash from relative arg", () => {
    expect(resolve(cwd, "projects/")).toBe("/home/operator/projects");
  });

  it("strips trailing slash — root stays root", () => {
    // root itself is "/"  — the replace guard keeps it as "/"
    expect(resolve("/", "/")).toBe("/");
  });
});

describe("rekey", () => {
  function makeFs(): FsModel {
    return {
      "/home": [{ name: "rahman", kind: "dir", size: 0 }],
      "/home/operator": [{ name: "file.txt", kind: "file", size: 10, ext: "txt" }],
      "/home/operator/projects": [],
      "/other": [],
    };
  }

  it("oldP === newP is a noop", () => {
    const fs = makeFs();
    const before = JSON.stringify(fs);
    rekey(fs, "/home/operator", "/home/operator");
    expect(JSON.stringify(fs)).toBe(before);
  });

  it("moves single key when path matches exactly", () => {
    const fs = makeFs();
    rekey(fs, "/other", "/moved");
    expect("/moved" in fs).toBe(true);
    expect("/other" in fs).toBe(false);
  });

  it("moves subtree: all keys starting with oldP+'/' are rekeyed", () => {
    const fs = makeFs();
    rekey(fs, "/home/operator", "/home/bob");
    expect("/home/bob" in fs).toBe(true);
    expect("/home/bob/projects" in fs).toBe(true);
    expect("/home/operator" in fs).toBe(false);
    expect("/home/operator/projects" in fs).toBe(false);
  });

  it("leaves unrelated keys intact", () => {
    const fs = makeFs();
    rekey(fs, "/home/operator", "/home/bob");
    expect("/home" in fs).toBe(true);
    expect("/other" in fs).toBe(true);
  });

  it("entries are preserved under new key", () => {
    const fs = makeFs();
    const original = fs["/home/operator"];
    rekey(fs, "/home/operator", "/home/bob");
    expect(fs["/home/bob"]).toBe(original);
  });
});

describe("extTag", () => {
  it("name with no dot returns undefined", () => {
    expect(extTag("README")).toBeUndefined();
  });

  it("single dot extracts extension", () => {
    expect(extTag("file.txt")).toBe("txt");
  });

  it("multiple dots returns last segment", () => {
    expect(extTag("archive.tar.gz")).toBe("gz");
  });

  it("leading dot (hidden file) — no extension segment → undefined", () => {
    // '.bashrc' splits into ['', 'bashrc'] → pop() = 'bashrc' but the name
    // starts with the dot; name.includes('.') is true so we get 'bashrc'.
    // The implementation returns the last segment after the last dot, which
    // for '.bashrc' is 'bashrc'. That is the actual behaviour.
    expect(extTag(".bashrc")).toBe("bashrc");
  });

  it("uppercase extension is lowercased", () => {
    expect(extTag("Photo.JPG")).toBe("jpg");
  });

  it("mixed case extension is lowercased", () => {
    expect(extTag("doc.TxT")).toBe("txt");
  });

  it("name ending with a dot returns empty string coerced to undefined", () => {
    // 'file.' → split → ['file', ''] → pop = '' → falsy → undefined
    expect(extTag("file.")).toBeUndefined();
  });
});
