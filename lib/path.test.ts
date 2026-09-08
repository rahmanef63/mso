// These strings become the `path=` of an /api/v1/fs request, so the edges are not
// cosmetic. The three copies this file replaced disagreed on exactly the cases
// below — Files' join left "/a//b" for a base with a trailing slash, and every
// caller happened to pass a clean base until one did not.
import { describe, expect, it } from "vitest";
import { joinPath, parentPath, baseName, extOf } from "./path";

describe("joinPath", () => {
  it("joins without doubling or dropping a separator", () => {
    expect(joinPath("/home/operator", "a.txt")).toBe("/home/operator/a.txt");
    expect(joinPath("/", "a.txt")).toBe("/a.txt");
    expect(joinPath("/home/operator/", "a.txt")).toBe("/home/operator/a.txt");
    expect(joinPath("/home/operator", "/a.txt")).toBe("/home/operator/a.txt");
    expect(joinPath("/home//", "//a.txt")).toBe("/home/a.txt");
  });
});

describe("parentPath", () => {
  it("walks up, and stops at the root instead of returning empty", () => {
    expect(parentPath("/home/operator/a.txt")).toBe("/home/operator");
    expect(parentPath("/home/operator/")).toBe("/home");
    expect(parentPath("/home")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
});

describe("baseName / extOf", () => {
  it("takes the last segment and the last dot", () => {
    expect(baseName("/a/b/c.txt")).toBe("c.txt");
    expect(baseName("/a/b/")).toBe("b");
    expect(baseName("/")).toBe("");
    expect(extOf("/a/my.trip.2026.JPG")).toBe("jpg");
    expect(extOf("/a/Makefile")).toBe("");
    // A dotfile's name after the dot IS treated as the extension, deliberately:
    // Preview's table lists `gitignore`/`editorconfig` as text, and that is only
    // reachable if ".gitignore" resolves to "gitignore".
    expect(extOf("/a/.gitignore")).toBe("gitignore");
  });
});
