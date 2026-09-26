import { describe, expect, it } from "vitest";
import { consumeCleanupPreview, issueCleanupPreview } from "./cleanup-preview";
const items = [{ id: "npm-cache", label: "npm", desc: "cache", bytes: 1, available: true }, { id: "tmp-old", label: "tmp", desc: "protected", bytes: 1, available: false }];
describe("cleanup preview", () => {
  it("requires explicit confirmation and makes the preview single-use", () => {
    const preview = issueCleanupPreview(items, 1000);
    expect(() => consumeCleanupPreview(preview.id, ["npm-cache"], false, 1001)).toThrow("confirmation");
    consumeCleanupPreview(preview.id, ["npm-cache"], true, 1002);
    expect(() => consumeCleanupPreview(preview.id, ["npm-cache"], true, 1003)).toThrow("expired");
  });
  it("refuses unavailable categories, duplicate selections and expired previews", () => {
    const preview = issueCleanupPreview(items, 1000);
    expect(() => consumeCleanupPreview(preview.id, ["tmp-old"], true, 1001)).toThrow("available");
    expect(() => consumeCleanupPreview(preview.id, ["npm-cache", "npm-cache"], true, 1001)).toThrow("available");
    expect(() => consumeCleanupPreview(preview.id, ["npm-cache"], true, 301001)).toThrow("expired");
  });
});
