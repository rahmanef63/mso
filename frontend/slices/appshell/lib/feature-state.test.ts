import { afterEach, expect, it } from "vitest";
import { featureStateKey, readFeatureState, writeFeatureState, subscribeFeatureState, pruneFeatureState, clearSensitiveFeatureState } from "./feature-state";
import { openWindow, closeWindow, serialize } from "./store";

afterEach(() => pruneFeatureState(new Set()));
it("preserves a draft across unmount/remount subscriptions and isolates each window", () => {
  const key = featureStateKey("w1", "draft"), other = featureStateKey("w2", "draft");
  const draft = { title: "Unsaved" }; let calls = 0;
  const off = subscribeFeatureState(key, () => calls++);
  writeFeatureState(key, "w1", draft); off();
  expect(readFeatureState(key, null)).toBe(draft);
  expect(readFeatureState(other, null)).toBeNull();
  const offAgain = subscribeFeatureState(key, () => calls++);
  writeFeatureState(key, "w1", draft);
  expect(calls).toBe(1); offAgain();
});
it("releases state when the owning window closes without affecting another window", () => {
  const id = openWindow("a", "A"), other = openWindow("b", "B");
  const key = featureStateKey(id, "draft"), otherKey = featureStateKey(other, "draft");
  writeFeatureState(key, id, "a"); writeFeatureState(otherKey, other, "b");
  closeWindow(id);
  expect(readFeatureState(key, null)).toBeNull();
  expect(readFeatureState(otherKey, null)).toBe("b"); closeWindow(other);
});

it("keeps unsaved credentials in the owning window memory without serializing them", () => {
  const id = openWindow("os-settings", "Settings"), other = openWindow("other-settings", "Other Settings");
  const key = featureStateKey(id, "provider-key"), otherKey = featureStateKey(other, "provider-key");
  const secret = "synthetic-unsubmitted-credential";
  writeFeatureState(key, id, secret, true);
  const stop = subscribeFeatureState(key, () => {}); stop();
  expect(readFeatureState(key, "")).toBe(secret);
  expect(readFeatureState(otherKey, "")).toBe("");
  expect(JSON.stringify(serialize())).not.toContain(secret);
  closeWindow(id);
  expect(readFeatureState(key, "")).toBe("");
  closeWindow(other);
});

it("removes sensitive drafts at the auth boundary while retaining other drafts", () => {
  const id = openWindow("settings", "Settings"), key = featureStateKey(id, "provider-json");
  const other = featureStateKey(id, "code-buffers");
  writeFeatureState(other, id, "unsaved buffer");
  writeFeatureState(key, id, "synthetic private JSON", true);
  writeFeatureState(key, id, "changed private JSON");
  let calls = 0; const off = subscribeFeatureState(key, () => calls++);
  clearSensitiveFeatureState();
  expect(readFeatureState(key, "")).toBe("");
  expect(readFeatureState(other, "")).toBe("unsaved buffer");
  expect(calls).toBe(1);
  off(); closeWindow(id);
});
