#!/usr/bin/env node
// Regression check for the audit-exceptions regex escaping.
//
//   node --test scripts/audit-exceptions.test.mjs
//
// Importing the script also runs the audit itself, which is fine: a stale
// exception makes that script fail, and this test then fails with it.
import assert from "node:assert/strict";
import test from "node:test";

import { escapeRegExp } from "./audit-exceptions.mjs";

test("escapeRegExp escapes regex metacharacters", () => {
  assert.equal(escapeRegExp("a.b"), "a\\.b");
  assert.equal(escapeRegExp("a+b"), "a\\+b");
  assert.equal(escapeRegExp("a(b)c"), "a\\(b\\)c");
  assert.equal(escapeRegExp("a\\b"), "a\\\\b");
});

test("escaped dot does not match an arbitrary character", () => {
  assert.equal(new RegExp(escapeRegExp("a.b")).test("axb"), false);
  assert.equal(new RegExp(escapeRegExp("a.b")).test("a.b"), true);
});

test("scoped package names still match themselves", () => {
  assert.equal(new RegExp(escapeRegExp("@scope/pkg")).test("@scope/pkg"), true);
  assert.equal(new RegExp(escapeRegExp("@sveltejs/vite-plugin-svelte")).test("@sveltejs/vite-plugin-svelte"), true);
});
