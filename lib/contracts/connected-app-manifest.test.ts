import { describe, expect, it } from "vitest";
import { parseConnectedAppManifest, validateConnectedAppManifest } from "./connected-app-manifest";
import template from "@/templates/connected-app/manifest.json";
const manifest = { schema: "urn:mso:connected-app:v1", schemaVersion: 1, id: "custom-editor", version: "1.0.0", title: "Custom editor", description: "My tool", publisher: "Example developer", presentation: "embed" };
describe("portable connected app manifest", () => {
  it("accepts the published starter template", () => { expect(validateConnectedAppManifest(template)).toEqual(template); });
  it("normalizes plain metadata without adding endpoints or authority", () => {
    expect(parseConnectedAppManifest(JSON.stringify({ ...manifest, title: " Editor " }))).toEqual({ ...manifest, title: "Editor" });
  });
  it.each(["0.0.0", "1.2.3-rc.1+build.7", "1.2.3-alpha-beta.0", "10.20.30+001"])("accepts semantic version %s", version => {
    expect(validateConnectedAppManifest({ ...manifest, version }).version).toBe(version);
  });
  it.each(["v1.0.0", "01.0.0", "1.0", "1.0.0-01", "1.0.0-", "1.0.0+", "1.0.0-..", "1.0.0 "])("rejects malformed version %s", version => {
    expect(() => validateConnectedAppManifest({ ...manifest, version })).toThrow();
  });
  it.each([
    { schemaVersion: 2 }, { schema: "urn:mso:feature:v1" }, { id: "../tool" }, { id: "A" },
    { title: "<script>run()</script>" }, { publisher: "line\nbreak" }, { presentation: "native" },
    { url: "https://developer.example.test" }, { secret: "not-allowed" }, { command: "run-tool" },
    { actions: ["exec"] }, { title: "x".repeat(121) }, { version: "1".repeat(129) },
  ])("rejects unsupported or executable metadata %j", change => {
    expect(() => validateConnectedAppManifest({ ...manifest, ...change })).toThrow();
  });
  it("rejects missing fields, arrays, invalid JSON and excessive UTF-8 input", () => {
    const missing: Record<string, unknown> = { ...manifest }; delete missing.publisher;
    expect(() => validateConnectedAppManifest(missing)).toThrow();
    expect(() => validateConnectedAppManifest([])).toThrow();
    expect(() => parseConnectedAppManifest("{broken")).toThrow("valid JSON");
    expect(() => parseConnectedAppManifest(JSON.stringify(manifest) + " ".repeat(8192))).toThrow("8 KiB");
    expect(() => parseConnectedAppManifest("界".repeat(3000))).toThrow("8 KiB");
  });
});
