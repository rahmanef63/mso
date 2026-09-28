import { describe, expect, it } from "vitest";
import { APP_CATALOG_MAX_BYTES, parseAppCatalog } from "./app-catalog";

const template = {
  schema: "urn:manef:app-catalog:v1",
  schemaVersion: 1,
  entries: [
    { kind: "managed", id: "hermes" },
    { kind: "connected", manifest: {
      schema: "urn:mso:connected-app:v1", schemaVersion: 1, id: "n8n", version: "1.0.0",
      title: "n8n template", description: "Connect an existing instance.", publisher: "MANEF catalog", presentation: "tab",
    } },
  ],
};

describe("public app catalog boundary", () => {
  it("accepts only reviewed adapter IDs and reusable connection metadata", () => {
    expect(parseAppCatalog(JSON.stringify(template)).entries).toHaveLength(2);
    expect(() => parseAppCatalog(JSON.stringify({ ...template, entries: [{ kind: "managed", id: "unreviewed" }] }))).toThrow("unknown managed adapter");
    expect(() => parseAppCatalog(JSON.stringify({ ...template, entries: [{ kind: "connected", manifest: { ...template.entries[1].manifest, command: "sh install" } }] }))).toThrow("unsupported fields");
  });
  it("rejects collisions and unexpected authority-bearing fields", () => {
    expect(() => parseAppCatalog(JSON.stringify({ ...template, entries: [template.entries[0], template.entries[0]] }))).toThrow("Duplicate catalog ID");
    expect(() => parseAppCatalog(JSON.stringify({ ...template, installCommand: "curl example" }))).toThrow("unsupported fields");
    expect(() => parseAppCatalog(JSON.stringify({ ...template, entries: [{ ...template.entries[0], endpoint: "http://127.0.0.1" }] }))).toThrow("unsupported fields");
  });
  it("bounds the catalog before parsing", () => {
    expect(() => parseAppCatalog("x".repeat(APP_CATALOG_MAX_BYTES + 1))).toThrow("32 KiB");
  });
});
