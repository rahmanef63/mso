import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { normalizeTelegramUpdate, verifyTelegramSecret } from "./providers/telegram";
import { normalizeDiscordInteraction, verifyDiscordSignature } from "./providers/discord";

describe("channel provider verification", () => {
  it("validates Telegram webhook secrets and normalizes messages", () => {
    const values = { webhookSecret: "secret_123" };
    expect(verifyTelegramSecret(values, "secret_123")).toBe(true);
    expect(verifyTelegramSecret(values, "wrong")).toBe(false);
    expect(normalizeTelegramUpdate({
      update_id: 42,
      message: { text: "hello", chat: { id: -1001 }, from: { id: 7 } },
    })).toMatchObject({ provider: "telegram", eventId: "42", kind: "message", target: "-1001", sender: "7", text: "hello" });
  });

  it("verifies Discord Ed25519 signatures and normalizes commands", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ format: "der", type: "spki" });
    const publicKeyHex = Buffer.from(der).subarray(-32).toString("hex");
    const timestamp = "1727000000";
    const body = JSON.stringify({ id: "123456789012345678", type: 2, application_id: "222222222222222222", channel_id: "333333333333333333", data: { name: "ask" }, member: { user: { id: "444444444444444444" } } });
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

    expect(verifyDiscordSignature({ publicKey: publicKeyHex }, timestamp, signature, body)).toBe(true);
    expect(verifyDiscordSignature({ publicKey: publicKeyHex }, timestamp, "00".repeat(64), body)).toBe(false);
    expect(normalizeDiscordInteraction(JSON.parse(body))).toMatchObject({
      provider: "discord", kind: "command", text: "ask", target: "333333333333333333", sender: "444444444444444444",
    });
  });
});
