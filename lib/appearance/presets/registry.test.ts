import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("./registry-data.json");
  vi.resetModules();
});

it("retries the registry after a failed load", async () => {
  vi.resetModules();
  vi.doMock("./registry-data.json", () => { throw new Error("load failed"); });
  const { loadPresetRegistry } = await import("./registry");
  await expect(loadPresetRegistry()).rejects.toThrow();
  vi.doUnmock("./registry-data.json");
  const registry = await loadPresetRegistry();
  expect(registry.items.length).toBeGreaterThan(0);
});
