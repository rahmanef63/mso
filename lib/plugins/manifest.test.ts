import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PLUGINS,
  PLUGIN_MANIFEST_SCHEMA,
  createPluginRegistry,
  validatePluginManifest,
} from "./manifest";

const valid = {
  $schema: PLUGIN_MANIFEST_SCHEMA,
  schemaVersion: 1,
  version: "1.2.3",
  id: "sample-plugin",
  metadata: {
    name: "Sample",
    description: "A safe portable plugin.",
    homepage: "https://example.test/plugin",
  },
  skills: [{ id: "help", path: "skills/help/SKILL.md" }],
  mcp: [{ transport: "https", endpoint: "https://mcp.example.test/v1" }],
} as const;

describe("portable plugin manifest v1", () => {
  it("ships SI-Coder and Batonly through the same host-neutral contract", () => {
    expect(BUILT_IN_PLUGINS.map((plugin) => plugin.id)).toEqual(["si-coder", "batonly"]);
    for (const plugin of BUILT_IN_PLUGINS) {
      expect(plugin.$schema).toBe(PLUGIN_MANIFEST_SCHEMA);
      expect(validatePluginManifest(plugin)).toEqual({ ok: true, manifest: plugin });
    }
  });

  it("registers safe custom declarations without installing or executing them", () => {
    expect(createPluginRegistry([valid]).map((plugin) => plugin.id)).toEqual(["si-coder", "batonly", "sample-plugin"]);
  });

  it("rejects unknown schema versions and unknown fields", () => {
    expect(validatePluginManifest({ ...valid, schemaVersion: 2 }).ok).toBe(false);
    expect(validatePluginManifest({ ...valid, $schema: "urn:other:v1" }).ok).toBe(false);
    expect(validatePluginManifest({ ...valid, extra: true }).ok).toBe(false);
  });

  it.each([
    { ...valid, apiToken: "nope" },
    { ...valid, command: "echo nope" },
    { ...valid, metadata: { ...valid.metadata, authorizationHeader: "nope" } },
  ])("rejects secret or executable-shaped fields", (bad) => {
    expect(validatePluginManifest(bad).ok).toBe(false);
  });

  it.each([
    { ...valid, skills: [{ id: "help", path: "../help/SKILL.md" }] },
    { ...valid, skills: [{ id: "help", path: "/tmp/help/SKILL.md" }] },
    { ...valid, mcp: [{ transport: "stdio", entrypoint: "../mcp.js", catalog: "machine/functions.json" }] },
    { ...valid, mcp: [{ transport: "https", endpoint: "http://mcp.example.test" }] },
    { ...valid, mcp: [{ transport: "https", endpoint: "https://user:pass@mcp.example.test" }] },
    { ...valid, mcp: [{ transport: "https", endpoint: "https://mcp.example.test?token=nope" }] },
    { ...valid, mcp: [{ transport: "https", endpoint: "https://mcp.example.test/#secret" }] },
  ])("rejects traversal, absolute paths, or unsafe remote descriptors", (bad) => {
    expect(validatePluginManifest(bad).ok).toBe(false);
  });

  it("deduplicates custom ids against built-ins and prior custom declarations", () => {
    const duplicateBuiltin = { ...valid, id: "si-coder" };
    const duplicateCustom = { ...valid, metadata: { ...valid.metadata, name: "Second" } };
    expect(createPluginRegistry([duplicateBuiltin, valid, duplicateCustom]).map((plugin) => plugin.id)).toEqual([
      "si-coder",
      "batonly",
      "sample-plugin",
    ]);
  });
});
