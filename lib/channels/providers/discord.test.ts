import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeDiscordInteraction, verifyDiscordSignature } from "./discord";

describe("discord channel adapter", () => {
  it("verifies Discord Ed25519 interaction signatures", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" });
    const publicKeyHex = Buffer.from(spki).subarray(-32).toString("hex");
    const timestamp = "1700000000";
    const body = JSON.stringify({ id: "123456789012345678", application_id: "111111111111111111", type: 1 });
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
    expect(verifyDiscordSignature({ publicKey: publicKeyHex }, timestamp, signature, body)).toBe(true);
    expect(verifyDiscordSignature({ publicKey: publicKeyHex }, timestamp, signature, body + "x")).toBe(false);
  });

  it("normalizes commands to the shared inbound event contract", () => {
    const event = normalizeDiscordInteraction({
      id: "123456789012345678",
      type: 2,
      channel_id: "222222222222222222",
      member: { user: { id: "333333333333333333" } },
      data: { name: "deploy" },
    });
    expect(event).toMatchObject({
      provider: "discord",
      eventId: "123456789012345678",
      kind: "command",
      target: "222222222222222222",
      sender: "333333333333333333",
      text: "deploy",
    });
  });
});
