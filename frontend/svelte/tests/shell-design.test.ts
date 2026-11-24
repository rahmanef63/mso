import { test } from "node:test";
import assert from "node:assert/strict";
import { designProfileFor, SHELL_DESIGN_PROFILES } from "../src/lib/shell/shell-design.ts";
import {
  clearAllWinState,
  clearWinState,
  getWinState,
  setWinState,
} from "../src/lib/shell/window-feature-state.ts";
import { createWindowStore } from "../src/lib/shell/window-store.ts";

test("designProfileFor returns distinct Settings and Files presentations for all five shells", () => {
  const settingsModes = new Set(Object.values(SHELL_DESIGN_PROFILES).map((p) => p.settingsNavigation));
  const filesModes = new Set(Object.values(SHELL_DESIGN_PROFILES).map((p) => p.filesVariant));
  assert.equal(settingsModes.size, 5);
  assert.equal(filesModes.size, 5);

  assert.equal(designProfileFor("macos").filesVariant, "finder");
  assert.equal(designProfileFor("windows").filesVariant, "explorer");
  assert.equal(designProfileFor("ios").filesVariant, "ios-files");
  assert.equal(designProfileFor("android").filesVariant, "android-files");
  assert.equal(designProfileFor("dashboard").filesVariant, "dashboard");

  assert.equal(designProfileFor("ios").mobileNavigation, "ios");
  assert.equal(designProfileFor("android").mobileNavigation, "android");
  assert.equal(designProfileFor("macos").mobileNavigation, "none");
  assert.equal(designProfileFor("windows").windowed, true);
  assert.equal(designProfileFor("dashboard").windowed, false);
});

test("window-feature-state isolates two Files windows and preserves drafts until exact window closes", () => {
  clearAllWinState();
  const ws = createWindowStore();
  const w1 = ws.openWindow("files", "Files", undefined, "/home/a", { multi: true });
  const w2 = ws.openWindow("files", "Files", undefined, "/home/b", { multi: true });

  setWinState(w1, "files.path", "/home/a/sub");
  setWinState(w2, "files.path", "/home/b/docs");
  ws.setWindowPayload(w1, "/home/a/sub");
  ws.setWindowPayload(w2, "/home/b/docs");

  assert.equal(getWinState(w1, "files.path", "~"), "/home/a/sub");
  assert.equal(getWinState(w2, "files.path", "~"), "/home/b/docs");
  assert.equal(ws.getState().windows[w1].payload, "/home/a/sub");
  assert.equal(ws.getState().windows[w2].payload, "/home/b/docs");

  // Closing w1 clears ONLY w1 state while w2 keeps its path and draft intact.
  clearWinState(w1);
  ws.closeWindow(w1);
  assert.equal(getWinState(w1, "files.path", "~"), "~");
  assert.equal(getWinState(w2, "files.path", "~"), "/home/b/docs");
  clearAllWinState();
});
