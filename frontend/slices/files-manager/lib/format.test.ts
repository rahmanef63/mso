import { describe, expect, it } from "vitest";
import { crumbsFor, fmtGiB, fmtSize, joinPath, parentPath, uniqueName } from "./format";

describe("fmtSize", () => {
  it("0 bytes → '0 B'", () => {
    expect(fmtSize(0)).toBe("0 B");
  });

  it("1023 bytes stays in B range", () => {
    expect(fmtSize(1023)).toBe("1023 B");
  });

  it("1024 bytes → '1 KB'", () => {
    expect(fmtSize(1024)).toBe("1 KB");
  });

  it("1536 bytes (1.5 KB) → '2 KB' (toFixed(0) rounds)", () => {
    expect(fmtSize(1536)).toBe("2 KB");
  });

  it("1024^2 bytes → '1.0 MB'", () => {
    expect(fmtSize(1024 ** 2)).toBe("1.0 MB");
  });

  it("1.5 MB → '1.5 MB'", () => {
    expect(fmtSize(1.5 * 1024 ** 2)).toBe("1.5 MB");
  });

  it("1 GiB - 1 byte is still MB range", () => {
    expect(fmtSize(1024 ** 3 - 1)).toMatch(/MB$/);
  });

  it("1024^3 bytes → '1.0 GB'", () => {
    expect(fmtSize(1024 ** 3)).toBe("1.0 GB");
  });

  it("2.5 GiB → '2.5 GB'", () => {
    expect(fmtSize(2.5 * 1024 ** 3)).toBe("2.5 GB");
  });
});

describe("fmtGiB", () => {
  it("1 GiB → '1.0 GiB'", () => {
    expect(fmtGiB(1024 ** 3)).toBe("1.0 GiB");
  });

  it("1.55 GiB rounds to '1.6 GiB'", () => {
    expect(fmtGiB(1.55 * 1024 ** 3)).toBe("1.6 GiB");
  });

  it("0 bytes → '0.0 GiB'", () => {
    expect(fmtGiB(0)).toBe("0.0 GiB");
  });

  it("512 MiB → '0.5 GiB'", () => {
    expect(fmtGiB(0.5 * 1024 ** 3)).toBe("0.5 GiB");
  });
});

describe("joinPath", () => {
  it("base '/' → '/name' (no double slash)", () => {
    expect(joinPath("/", "foo")).toBe("/foo");
  });

  it("normal base → 'base/name'", () => {
    expect(joinPath("/home/operator", "projects")).toBe("/home/operator/projects");
  });

  it("nested base works correctly", () => {
    expect(joinPath("/a/b/c", "d")).toBe("/a/b/c/d");
  });

  it("name with dot preserved", () => {
    expect(joinPath("/home", "file.txt")).toBe("/home/file.txt");
  });
});

describe("parentPath", () => {
  it("root stays '/'", () => {
    expect(parentPath("/")).toBe("/");
  });

  it("single-level '/foo' → '/'", () => {
    expect(parentPath("/foo")).toBe("/");
  });

  it("multi-level '/a/b/c' → '/a/b'", () => {
    expect(parentPath("/a/b/c")).toBe("/a/b");
  });

  it("trailing slash stripped before computing parent", () => {
    expect(parentPath("/a/b/")).toBe("/a");
  });

  it("double trailing slash stripped", () => {
    expect(parentPath("/a/b//")).toBe("/a");
  });
});

describe("crumbsFor", () => {
  it("preserves home-relative navigation instead of inventing /~", () => {
    expect(crumbsFor("~")).toEqual([{ name: "Home", path: "~" }]);
    expect(crumbsFor("~/projects/app")).toEqual([{ name: "Home", path: "~" }, { name: "projects", path: "~/projects" }, { name: "app", path: "~/projects/app" }]);
  });
  it("root path → single crumb [root]", () => {
    expect(crumbsFor("/")).toEqual([{ name: "mso", path: "/" }]);
  });

  it("single-level → [root, segment]", () => {
    expect(crumbsFor("/home")).toEqual([
      { name: "mso", path: "/" },
      { name: "home", path: "/home" },
    ]);
  });

  it("multi-level → all segments with correct paths", () => {
    expect(crumbsFor("/home/operator/projects")).toEqual([
      { name: "mso", path: "/" },
      { name: "home", path: "/home" },
      { name: "operator", path: "/home/operator" },
      { name: "projects", path: "/home/operator/projects" },
    ]);
  });

  it("custom root label overrides default", () => {
    const crumbs = crumbsFor("/", "MSO");
    expect(crumbs[0].name).toBe("MSO");
  });

  it("custom root label applies to multi-level too", () => {
    const crumbs = crumbsFor("/a/b", "Root");
    expect(crumbs[0]).toEqual({ name: "Root", path: "/" });
    expect(crumbs).toHaveLength(3);
  });
});

describe("uniqueName", () => {
  it("no collision → returns original name", () => {
    expect(uniqueName(new Set(["other.txt"]), "file.txt")).toBe("file.txt");
  });

  it("single collision → appends ' copy' before extension", () => {
    const taken = new Set(["file.txt"]);
    expect(uniqueName(taken, "file.txt")).toBe("file copy.txt");
  });

  it("double collision → appends ' copy copy' before extension", () => {
    const taken = new Set(["file.txt", "file copy.txt"]);
    expect(uniqueName(taken, "file.txt")).toBe("file copy copy.txt");
  });

  it("no extension → appends ' copy' to end", () => {
    const taken = new Set(["readme"]);
    expect(uniqueName(taken, "readme")).toBe("readme copy");
  });

  it("no extension double collision", () => {
    const taken = new Set(["readme", "readme copy"]);
    expect(uniqueName(taken, "readme")).toBe("readme copy copy");
  });

  it("preserves multi-part extension (.tar.gz treated as .gz)", () => {
    // dot > 0 finds the LAST dot, so archive.tar.gz → archive.tar copy.gz
    const taken = new Set(["archive.tar.gz"]);
    expect(uniqueName(taken, "archive.tar.gz")).toBe("archive.tar copy.gz");
  });

  it("empty taken set → returns name unchanged", () => {
    expect(uniqueName(new Set(), "anything.doc")).toBe("anything.doc");
  });
});
