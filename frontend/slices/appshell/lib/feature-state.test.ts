import { afterEach, expect, it } from "vitest";
import { featureStateKey, readFeatureState, writeFeatureState, subscribeFeatureState, pruneFeatureState } from "./feature-state";
import { openWindow, closeWindow } from "./store";

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
