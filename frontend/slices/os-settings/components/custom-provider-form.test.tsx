import { describe, expect, it } from "vitest";
import {
  DISCOVERY_MESSAGES,
  baseUrlLooksValid,
  claimDiscovery,
  classifyDiscovery,
  discoveryPairKey,
  modelFieldFromDiscovered,
  type DiscoveryFailure,
} from "./custom-provider-form";

// Complaint 2 ("susah add custom provider"): the three discovery failures must
// stay distinct, and discovery must pre-select everything it finds.

describe("discovery failure classification", () => {
  it("keeps three different messages, one per failure kind", () => {
    const kinds: DiscoveryFailure[] = ["invalid-url", "auth", "empty"];
    const messages = kinds.map((kind) => DISCOVERY_MESSAGES[kind]);
    expect(new Set(messages).size).toBe(3);
    for (const message of messages) expect(message.length).toBeGreaterThan(20);
    expect(DISCOVERY_MESSAGES.auth).toContain("401/403");
    expect(DISCOVERY_MESSAGES["invalid-url"]).toMatch(/https:\/\//);
  });

  it("maps a rejected key to the auth message, not a generic error", () => {
    expect(classifyDiscovery(401, {})).toBe("auth");
    expect(classifyDiscovery(403, {})).toBe("auth");
    expect(classifyDiscovery(200, { ok: false, error: "model discovery HTTP 401" })).toBe("auth");
  });

  it("maps a malformed/unsafe URL rejection separately from auth", () => {
    expect(classifyDiscovery(400, { error: "Base URL is not a valid URL" })).toBe("invalid-url");
    expect(classifyDiscovery(200, { ok: false, error: "model discovery request failed" })).toBe("invalid-url");
  });

  it("maps a reachable endpoint with an empty list to the no-models message", () => {
    expect(classifyDiscovery(200, { ok: true, models: [] })).toBe("empty");
    expect(classifyDiscovery(200, { ok: true })).toBe("empty");
    expect(classifyDiscovery(200, { ok: false, error: "model discovery returned invalid JSON" })).toBe("empty");
  });

  it("returns null only when models actually came back", () => {
    expect(classifyDiscovery(200, { ok: true, models: [{ id: "gpt-4o", name: "GPT-4o" }] })).toBeNull();
  });
});

describe("auto-discovery guard", () => {
  it("keys a run by the exact baseURL+key pair and refuses unusable pairs", () => {
    expect(discoveryPairKey("", "sk-1")).toBeNull();
    expect(discoveryPairKey("not-a-url", "sk-1")).toBeNull();
    expect(discoveryPairKey("https://host/v1", "  ")).toBeNull();
    expect(discoveryPairKey("https://host/v1", "sk-1")).not.toBe(discoveryPairKey("https://host/v1", "sk-2"));
  });

  it("claims each pair at most once, so a debounce can never fire twice", () => {
    const fired = new Set<string>();
    const pair = discoveryPairKey("https://host/v1", "sk-1");
    expect(claimDiscovery(fired, pair)).toBe(true);
    expect(claimDiscovery(fired, pair)).toBe(false);
    expect(claimDiscovery(fired, null)).toBe(false);
    expect(claimDiscovery(fired, discoveryPairKey("https://host/v1", "sk-2"))).toBe(true);
  });

  it("only treats a real http(s) URL as valid", () => {
    expect(baseUrlLooksValid("https://host/v1")).toBe(true);
    expect(baseUrlLooksValid("http://10.0.0.2:8080/v1")).toBe(true);
    expect(baseUrlLooksValid("host/v1")).toBe(false);
    expect(baseUrlLooksValid("file:///etc/passwd")).toBe(false);
    expect(baseUrlLooksValid("")).toBe(false);
  });
});

describe("discovered models are pre-selected", () => {
  it("puts every discovered id into the models field", () => {
    expect(modelFieldFromDiscovered([{ id: "gpt-4o", name: "GPT-4o" }, { id: "o3", name: "o3" }]))
      .toBe("gpt-4o, o3");
    expect(modelFieldFromDiscovered([])).toBe("");
  });
});
