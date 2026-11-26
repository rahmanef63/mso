import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeViewMode, viewModeLabel } from "../src/lib/files/files-select-actions.ts";

// The third Finder mode is presented as "Details" but its persisted window-state
// value is the legacy "columns". These assertions pin both halves of that
// contract: an old saved state still resolves to a real mode (no throw, no empty
// view), and that mode presents as "Details".
test("persisted viewMode 'columns' resolves to the Details presentation", () => {
  const restored = normalizeViewMode("columns");
  assert.equal(restored, "columns");
  assert.equal(viewModeLabel(restored), "Details");
});

test("unknown or missing persisted viewMode falls back to List instead of throwing", () => {
  for (const raw of [undefined, null, "", "Columns", "tiles", 3, {}]) {
    assert.equal(normalizeViewMode(raw), "list");
  }
});

test("every view mode has exactly one stable label", () => {
  assert.deepEqual(
    ["grid", "list", "columns"].map((m) => viewModeLabel(normalizeViewMode(m))),
    ["Icons", "List", "Details"],
  );
});
