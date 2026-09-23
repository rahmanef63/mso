import { describe, expect, it } from "vitest";
import { parseChannelPatch, validateTarget } from "./schema";

describe("channel schema", () => {
  const base = {
    name: "Support",
    provider: "telegram",
    credential: { user: "owner", connection: "bot" },
    enabled: true,
  };

  it("keeps channel records metadata-only", () => {
    expect(() => parseChannelPatch({ ...base, botToken: "123456:abcdefghijklmnopqrstuvwxyz" })).toThrow("secret_input_forbidden");
  });

  it("validates provider-specific targets", () => {
    expect(validateTarget("telegram", "-100123456789")).toBe("-100123456789");
    expect(validateTarget("discord", "123456789012345")).toBe("123456789012345");
    expect(() => validateTarget("discord", "#general")).toThrow("invalid_discord_target");
  });
});
