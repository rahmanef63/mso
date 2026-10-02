import { beforeEach, describe, expect, it, vi } from "vitest";

const writeConfig = vi.fn();
const setKey = vi.fn();
const deleteKey = vi.fn();
const upsertCustomProvider = vi.fn();
const removeCustomProvider = vi.fn();
const removeOAuthBundle = vi.fn();
const readConfig = vi.fn();
const getKey = vi.fn();

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn(async () => true) }));
vi.mock("@/lib/config/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/config/store")>(),
  DEFAULT_MODEL: "default-model",
  DEFAULT_PROVIDER: "anthropic",
  readConfig: (...args: unknown[]) => readConfig(...args),
  writeConfig: (...args: unknown[]) => writeConfig(...args),
  hostCredentialStore: () => ({
    getKey: (...args: unknown[]) => getKey(...args),
    setKey: (...args: unknown[]) => setKey(...args),
    deleteKey: (...args: unknown[]) => deleteKey(...args),
  }),
  upsertCustomProvider: (...args: unknown[]) => upsertCustomProvider(...args),
  removeCustomProvider: (...args: unknown[]) => removeCustomProvider(...args),
  removeOAuthBundle: (...args: unknown[]) => removeOAuthBundle(...args),
}));
vi.mock("@/lib/models/defaults", () => ({ DEFAULT_PROVIDER: "anthropic", defaultModelFor: (p: string) => `${p}-default` }));
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
    getKey.mockReset().mockResolvedValue("");
  });

  it.each([
    null, [], { provider: 1 }, { provider: " " }, { provider: "../openai" },
    { provider: "constructor" }, { provider: "missing-provider" }, { model: [] }, { model: " " },
    { apiKey: {} }, { select: "false" }, { customProvider: "invalid" },
    { customProvider: { name: "constructor", baseURL: "https://ai.example.com/v1", apiKey: "secret" } },
    { customProvider: { name: "Hub", apiKey: 1 } },
    { customProvider: { name: "Hub", baseURL: "https://ai.example.com/v1", apiKey: "secret", models: "m1" } },
  ].map((body) => [body]))("rejects malformed config before mutation: %j", async (body) => {
    const { POST } = await import("./route");
    expect((await POST(request(body))).status).toBe(400);
    expect(writeConfig).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
    expect(upsertCustomProvider).not.toHaveBeenCalled();
  });

  it("preserves the active provider on a model-only update", async () => {
    readConfig.mockResolvedValue({ provider: "google", model: "gemini-old" });
    const { POST } = await import("./route");
    expect((await POST(request({ model: "gemini-next" }))).status).toBe(200);
    expect(writeConfig).toHaveBeenCalledWith({ provider: "google", model: "gemini-next" });
  });

  it("uses the new built-in provider default when switching without a model", async () => {
    const { POST } = await import("./route");
    await POST(request({ provider: "google" }));
    expect(writeConfig).toHaveBeenCalledWith({ provider: "google", model: "google-default" });
  });

  it("requires an explicit account model when switching to Codex", async () => {
    const { POST } = await import("./route");
    expect((await POST(request({ provider: "openai-codex" }))).status).toBe(400);
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it("keeps the selected Codex model when updating its existing selection", async () => {
    readConfig.mockResolvedValue({ provider: "openai-codex", model: "gpt-account-model" });
    const { POST } = await import("./route");
    expect((await POST(request({ provider: "openai-codex" }))).status).toBe(200);
    expect(writeConfig).toHaveBeenCalledWith({ provider: "openai-codex", model: "gpt-account-model" });
  });

  it("selects the first declared custom model without inheriting the old model", async () => {
    readConfig.mockResolvedValue({ provider: "anthropic", model: "claude-active", customProviders: { hub: { baseUrl: "https://ai.example.com/v1", models: ["hub-model"] } } });
    const { POST } = await import("./route");
    await POST(request({ provider: "hub" }));
    expect(writeConfig).toHaveBeenCalledWith({ provider: "hub", model: "hub-model" });
  });

  it("only connects a custom provider with no known model", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ customProvider: { name: "Hub", baseURL: "https://ai.example.com/v1", apiKey: "secret" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ selected: false });
    expect(setKey).toHaveBeenCalled();
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it("lists env-connected built-ins without exposing or masking their keys", async () => {
    getKey.mockImplementation(async (_tenant: unknown, id: string) => id === "google" ? "env-private-sentinel" : "");
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();
    expect(body.providers).toEqual([expect.objectContaining({ id: "google", kind: "builtin", hasKey: true, masked: "" })]);
    expect(JSON.stringify(body)).not.toContain("env-private");
  });

  it("stores a built-in provider key with select:false without changing the active provider/model", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ provider: "openrouter", apiKey: "secret", select: false }));
    expect(res.status).toBe(200);
    expect(setKey).toHaveBeenCalledWith(undefined, "openrouter", "secret");
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it("keeps normal POST behavior selecting an explicitly chosen provider+model", async () => {
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

  it("keeps Google active and connected after Codex credentials are added", async () => {
    readConfig.mockResolvedValue({
      provider: "google",
      model: "gemini-2.0-flash",
      keys: { google: "google-secret" },
      customProviders: {},
      oauthTokens: { "openai-codex": { kind: "oauth", access: "codex-token", expires: Date.now() + 60_000 } },
    });
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(body).toMatchObject({ provider: "google", model: "gemini-2.0-flash", hasApiKey: true });
    expect(body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "google", kind: "builtin", hasKey: true }),
      expect.objectContaining({ id: "openai-codex", kind: "oauth", hasKey: true }),
    ]));
  });

  it("can explicitly switch Codex on and then return to Google Gemini without touching credentials", async () => {
    const { POST } = await import("./route");
    await POST(request({ provider: "openai-codex", model: "gpt-account-model" }));
    await POST(request({ provider: "google", model: "gemini-2.0-flash" }));
    expect(writeConfig).toHaveBeenNthCalledWith(1, { provider: "openai-codex", model: "gpt-account-model" });
    expect(writeConfig).toHaveBeenNthCalledWith(2, { provider: "google", model: "gemini-2.0-flash" });
    expect(setKey).not.toHaveBeenCalled();
    expect(deleteKey).not.toHaveBeenCalled();
  });
});
