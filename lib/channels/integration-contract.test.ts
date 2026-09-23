import { describe, expect, it } from "vitest";
import { connectionCatalog } from "@/lib/infra/connection-registry";
import { normalizeInfraValues } from "@/lib/infra/catalog";

describe("channel integration providers", () => {
  it("publishes Telegram and Discord direct credentials with secret metadata", () => {
    const catalog = connectionCatalog();
    const telegram = catalog.find((row) => row.id === "telegram")!;
    const discord = catalog.find((row) => row.id === "discord")!;
    expect(telegram.sources[0]?.methods[0]?.fields.find((field) => field.key === "botToken")?.secret).toBe(true);
    expect(telegram.sources[0]?.methods[0]?.fields.find((field) => field.key === "webhookSecret")?.secret).toBe(true);
    expect(discord.sources[0]?.methods[0]?.fields.find((field) => field.key === "botToken")?.secret).toBe(true);
    expect(discord.sources[0]?.methods[0]?.fields.find((field) => field.key === "publicKey")?.secret).toBe(false);
  });

  it("rejects malformed provider identity fields before persistence", () => {
    expect(() => normalizeInfraValues("telegram", { botToken: "bad token" })).toThrow("Telegram bot token format");
    expect(() => normalizeInfraValues("discord", { botToken: "A".repeat(32), publicKey: "nope" })).toThrow("Discord publicKey");
  });
});
