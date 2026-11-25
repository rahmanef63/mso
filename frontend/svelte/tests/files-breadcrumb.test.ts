import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPathSegments, joinFsPath, validateEntryName } from "../src/lib/files/files-path-utils.ts";

const ROOTS = [
  { label: "Home", path: "/home/demo" },
  { label: "Projects", path: "/home/demo/projects" },
];

test("breadcrumbs never offer a root the backend rejects", () => {
  // `/` and `/home` are not readable roots: resolveRoots() returns home plus the
  // configured roots, so a crumb pointing there navigates into a permanent
  // "The requested path was not found" state.
  for (const path of ["/", "/home", "/home/demo", "/home/demo/projects", "/home/demo/projects/sub"]) {
    for (const crumb of buildPathSegments(path, ROOTS)) {
      assert.notEqual(crumb.path, "/", `no crumb may target / (from ${path})`);
      assert.notEqual(crumb.path, "/home", `no crumb may target /home (from ${path})`);
    }
  }
});

test("breadcrumbs anchor on the real root that prefixes the path", () => {
  assert.deepEqual(buildPathSegments("/home/demo/projects", ROOTS), [
    { label: "Projects", path: "/home/demo/projects" },
  ]);
  assert.deepEqual(buildPathSegments("/home/demo/projects/sub/deep", ROOTS), [
    { label: "Projects", path: "/home/demo/projects" },
    { label: "sub", path: "/home/demo/projects/sub" },
    { label: "deep", path: "/home/demo/projects/sub/deep" },
  ]);
  assert.deepEqual(buildPathSegments("/home/demo/docs", ROOTS), [
    { label: "Home", path: "/home/demo" },
    { label: "docs", path: "/home/demo/docs" },
  ]);
});

test("the deepest matching root wins and every crumb is navigable", () => {
  const crumbs = buildPathSegments("/home/demo/projects/app/src", ROOTS);
  assert.equal(crumbs[0]?.path, "/home/demo/projects", "Projects must win over Home");
  for (const crumb of crumbs) {
    assert.ok(crumb.path.startsWith("/home/demo"), `${crumb.path} must sit under a readable root`);
  }
});

test("path resolution falls back to Home when no root is known", () => {
  assert.deepEqual(buildPathSegments("~", []), [{ label: "Home", path: "~" }]);
  assert.deepEqual(buildPathSegments("/", []), [{ label: "Home", path: "~" }]);
});

test("join and name validation keep their existing contract", () => {
  assert.equal(joinFsPath("/home/demo", "sub/a.ts"), "/home/demo/sub/a.ts");
  assert.equal(joinFsPath("/", "etc"), "/etc");
  assert.equal(validateEntryName("ok"), null);
  assert.ok(validateEntryName("../escape"));
  assert.ok(validateEntryName("a/b"));
});
