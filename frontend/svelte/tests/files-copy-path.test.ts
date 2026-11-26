import { test } from "node:test";
import assert from "node:assert/strict";
import { joinFsPath, normalizeFsPath } from "../src/lib/files/files-path-utils.ts";

// Finder/Explorer "Copy path" must yield exactly one normalized pathname from
// every surface. The List view joined the directory itself and then the entry
// pane joined it again, and the manager joined a third time, producing
// `/home/demo//home/demo//home/demo/notes.txt`. Re-joining an already-absolute
// path is a no-op now, so all three surfaces converge on one path.

const DIR = "/home/demo";
const NAME = "notes.txt";
const FULL = "/home/demo/notes.txt";

test("one join produces the plain absolute pathname", () => {
  assert.equal(joinFsPath(DIR, NAME), FULL);
});

test("joined paths are idempotent under re-joining (List/Grid/Details convergence)", () => {
  const once = joinFsPath(DIR, NAME);
  assert.equal(joinFsPath(DIR, once), once);
  assert.equal(joinFsPath(DIR, joinFsPath(DIR, once)), once);
  assert.equal(joinFsPath(DIR, FULL), FULL);
});

test("repeated and trailing separators normalize away, except at the filesystem root", () => {
  assert.equal(normalizeFsPath("/home/demo//notes.txt"), "/home/demo/notes.txt");
  assert.equal(normalizeFsPath("/home/demo/notes.txt/"), "/home/demo/notes.txt");
  assert.equal(normalizeFsPath("/home//demo///notes.txt"), "/home/demo/notes.txt");
  assert.equal(normalizeFsPath("/"), "/");
  assert.equal(normalizeFsPath(""), "");
});

test("home-relative paths stay home-relative and never gain a duplicate root", () => {
  assert.equal(joinFsPath("~", NAME), "~/notes.txt");
  assert.equal(joinFsPath("~", "~/notes.txt"), "~/notes.txt");
  assert.equal(normalizeFsPath("~/docs/"), "~/docs");
});

test("root-level directories join without a doubled slash", () => {
  assert.equal(joinFsPath("/", NAME), "/notes.txt");
  assert.equal(joinFsPath("", NAME), "/notes.txt");
});
