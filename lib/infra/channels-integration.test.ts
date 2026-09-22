import { describe, expect, it } from "vitest";
import { getInfraProviderDefinition, normalizeInfraValues } from "./catalog";
import { connectionCatalog } from "./connection-registry";

describe("Channels integration providers", () => {
  it("registers Telegram and Discord as direct secret-bearing Integrations", () => {
    const catalog = connectionCatalog();
    for (const id of ["telegram", "discord"] as const) {
      const row = catalog.find((item) => item.id === id);
      expect(row?.sources.map((source) => source.id)).toEqual(["direct"]);
      expect(getInfraProviderDefinition(id).fields.find((field) => field.key === "botToken")?.secret).toBe(true);
    }
  });

  it("validates public interaction metadata without treating it as secret", () => {
    expect(normalizeInfraValues("discord", {
      botToken: "abcdefghijklmnopqrstuvwxyz123456",
      applicationId: "123456789012345678",
      publicKey: "a".repeat(64),
    }).applicationId).toBe("123456789012345678");
    expect(() => normalizeInfraValues("telegram", { botToken: "not-a-token" })).toThrow("Telegram bot token format");
  });
});
