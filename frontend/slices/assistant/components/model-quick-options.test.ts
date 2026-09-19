import { describe, expect, it } from "vitest";
import { quickModelForProvider, quickProviderIds, quickProviderLabel } from "./model-quick-options";

describe("Alfa connected-provider quick selection", () => {
  it("shows only the active and already-connected providers", () => {
    expect(quickProviderIds("google", [
      { id: "google", kind: "builtin", hasKey: true },
      { id: "openai-codex", kind: "oauth", hasKey: true },
      { id: "openrouter", kind: "builtin", hasKey: false },
    ])).toEqual(["google", "openai-codex"]);
  });

  it("keeps Gemini available after Codex is connected and prefers the Google default when switching back", () => {
    const googleModels = [{ id: "gemini-2.0-flash" }, { id: "gemini-2.5-pro" }];
    expect(quickModelForProvider("google", googleModels, "openai-codex", "gpt-account-model")).toBe("gemini-2.0-flash");
    expect(quickProviderLabel("google")).toBe("Google Gemini");
    expect(quickProviderLabel("openai-codex")).toBe("OpenAI Codex");
  });

  it("never invents a Codex fallback outside the account model list", () => {
    expect(quickModelForProvider("openai-codex", [{ id: "gpt-account-model" }], "google", "gemini-2.0-flash")).toBe("gpt-account-model");
    expect(quickModelForProvider("openai-codex", [], "google", "gemini-2.0-flash")).toBe("");
  });
});
