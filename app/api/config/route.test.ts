import { beforeEach, describe, expect, it, vi } from "vitest";

const writeConfig = vi.fn();
const setKey = vi.fn();
const deleteKey = vi.fn();
const upsertCustomProvider = vi.fn();
const removeCustomProvider = vi.fn();
const removeOAuthBundle = vi.fn();
const readConfig = vi.fn();

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn(async () => true) }));
vi.mock("@/lib/config/store", () => ({
  DEFAULT_MODEL: "default-model",
  DEFAULT_PROVIDER: "anthropic",
  readConfig: (...args: unknown[]) => readConfig(...args),
  writeConfig: (...args: unknown[]) => writeConfig(...args),
  hostCredentialStore: () => ({
    getKey: vi.fn(async () => ""),
    setKey: (...args: unknown[]) => setKey(...args),
    deleteKey: (...args: unknown[]) => deleteKey(...args),
  }),
  isBuiltinProvider: (id: string) => ["anthropic", "openai", "openrouter", "google", "groq", "xai", "deepseek", "mistral"].includes(id),
  slugifyProvider: (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  upsertCustomProvider: (...args: unknown[]) => upsertCustomProvider(...args),
  removeCustomProvider: (...args: unknown[]) => removeCustomProvider(...args),
  removeOAuthBundle: (...args: unknown[]) => removeOAuthBundle(...args),
}));
vi.mock("@/lib/models/defaults", () => ({ defaultModelFor: (p: string) => `${p}-default` }));
vi.mock("@/lib/host/ssrf", () => ({
  resolveSafeProviderEndpoint: vi.fn(async (url: string) => ({ url: new URL(url) })),
}));

const request = (body: unknown) => new Request("http://localhost/api/config", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}) as never;

describe("/api/config provider-auth vs model-selection contract", () => {
  beforeEach(() => {
    writeConfig.mockReset().mockResolvedValue(undefined);
    setKey.mockReset().mockResolvedValue(undefined);
    deleteKey.mockReset().mockResolvedValue(undefined);
    upsertCustomProvider.mockReset().mockResolvedValue(undefined);
    removeCustomProvider.mockReset().mockResolvedValue(undefined);
    removeOAuthBundle.mockReset().mockResolvedValue(undefined);
    readConfig.mockReset().mockResolvedValue({ provider: "anthropic", model: "claude-active", keys: {}, customProviders: {}, oauthTokens: {} });
  });

  it("stores a built-in provider key with select:false without changing the active provider/model", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ provider: "openrouter", apiKey: "secret", select: false }));
    expect(res.status).toBe(200);
    expect(setKey).toHaveBeenCalledWith(undefined, "openrouter", "secret");
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it("keeps legacy/default POST behavior selecting provider+model when select is omitted", async () => {
    const { POST } = await import("./route");
    await POST(request({ provider: "openrouter", model: "openai/gpt-4o" }));
    expect(writeConfig).toHaveBeenCalledWith({ provider: "openrouter", model: "openai/gpt-4o" });
  });

  it("adds a custom provider with select:false without switching the active model", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({
      customProvider: { name: "My Hub", baseURL: "https://ai.example.com/v1", apiKey: "secret", protocol: "openai", models: ["m1"] },
      select: false,
    }));
    expect(res.status).toBe(200);
    expect(upsertCustomProvider).toHaveBeenCalledWith("my-hub", expect.objectContaining({ models: ["m1"] }));
    expect(setKey).toHaveBeenCalledWith(undefined, "my-hub", "secret");
    expect(writeConfig).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ slug: "my-hub", selected: false });
  });
});
