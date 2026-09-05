import { describe, expect, it } from "vitest";
import { browserResetKeys, resetBrowserState } from "./browser-reset";

function storage(): Storage {
  const values = new Map<string, string>([
    ["mso:tweaks", "appearance"], ["mso.device.id", "approved-device"], ["sv:dock", "layout"],
    ["alfa.playbooks", "playbooks"], ["reel.draft", "draft"], ["mso:demo-fs", "sample"], ["other-app", "keep"],
  ]);
  return { get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }, clear: () => values.clear() };
}
describe("browser reset ownership", () => {
  it("previews without changing data", () => { const s = storage(); expect(browserResetKeys(s, "browser")).toHaveLength(5); expect(s.length).toBe(7); });
  it("appearance-only preserves drafts and device approval", () => {
    const s = storage(); expect(resetBrowserState(s, "appearance")).toBe(1);
    expect(s.getItem("reel.draft")).toBe("draft"); expect(s.getItem("mso.device.id")).toBe("approved-device");
  });
  it("removes every owned entry without skipping shifting indices", () => {
    const s = storage(); expect(resetBrowserState(s, "browser")).toBe(5);
    expect(s.length).toBe(2); expect(s.getItem("mso.device.id")).toBe("approved-device"); expect(s.getItem("other-app")).toBe("keep");
  });
});
