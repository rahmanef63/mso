import { describe, expect, it } from "vitest";
import { normalizeTelegramUpdate, verifyTelegramSecret } from "./telegram";

describe("telegram channel adapter", () => {
  it("validates the configured webhook secret with constant-time semantics", () => {
    const values = { webhookSecret: "secret_123" };
    expect(verifyTelegramSecret(values, "secret_123")).toBe(true);
    expect(verifyTelegramSecret(values, "secret_124")).toBe(false);
    expect(verifyTelegramSecret({}, "secret_123")).toBe(false);
  });

  it("normalizes message updates without changing provider payload semantics", () => {
    const event = normalizeTelegramUpdate({
      update_id: 42,
      message: { text: "hello", chat: { id: -100123 }, from: { id: 7 } },
    });
    expect(event).toMatchObject({
      provider: "telegram",
      eventId: "42",
      kind: "message",
      target: "-100123",
      sender: "7",
      text: "hello",
    });
  });
});
