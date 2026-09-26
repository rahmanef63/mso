import { describe, expect, it } from "vitest";
import { validateManifest, snapshotComplete, type Manifest } from "./manifest";
const id = "11111111-1111-4111-8111-111111111111";
const fixture = (): Manifest => ({ version: 1, id, createdAt: "2026-01-01T00:00:00.000Z", sourceDiscoveryTruncated: false,
  scan: { files: 1, bytes: 3, missing: 2, rejected: 0, excluded: 1, truncated: false },
  entries: [{ name: "memory/note.md", bytes: 3, sha256: "a".repeat(64), compressedBytes: 23, compressedSha256: "b".repeat(64) }] });
describe("backup manifest coverage", () => {
  it("accepts captured scope with explicitly counted optional missing sources", () => {
    expect(snapshotComplete(validateManifest(fixture(), id))).toBe(true);
  });
  it.each(["files", "bytes"] as const)("rejects inconsistent %s totals", (key) => {
    const m = fixture(); m.scan[key]++;
    expect(() => validateManifest(m, id)).toThrow("coverage totals");
  });
  it("rejects duplicate entries, unsafe names and negative sizes", () => {
    const duplicate = fixture(); duplicate.entries.push(duplicate.entries[0]);
    expect(() => validateManifest(duplicate, id)).toThrow("unsafe backup entry");
    for (const name of ["../escape", "/absolute", "memory/../../escape"]) {
      const m = fixture(); m.entries[0].name = name;
      expect(() => validateManifest(m, id)).toThrow("unsafe backup entry");
    }
    const m = fixture(); m.entries[0].bytes = -1;
    expect(() => validateManifest(m, id)).toThrow("unsafe backup entry");
  });
  it("keeps truncated, rejected, empty and discovery-incomplete captures partial", () => {
    for (const key of ["truncated", "rejected"] as const) {
      const m = fixture(); Object.assign(m.scan, { [key]: key === "truncated" ? true : 1 });
      expect(snapshotComplete(validateManifest(m, id))).toBe(false);
    }
    const m = fixture(); m.sourceDiscoveryTruncated = true;
    expect(snapshotComplete(m)).toBe(false);
    m.entries = []; m.scan.files = 0; m.scan.bytes = 0;
    expect(snapshotComplete(validateManifest(m, id))).toBe(false);
  });
  it("rejects malformed metadata before accepting a snapshot", () => {
    for (const patch of [{ createdAt: "invalid" }, { version: 2 }, { sourceDiscoveryTruncated: "false" }, { scan: {} }]) {
      expect(() => validateManifest({ ...fixture(), ...patch }, id)).toThrow("invalid backup manifest");
    }
  });
});
