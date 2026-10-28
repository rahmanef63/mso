import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/require-session";

const listModels = vi.fn();
const readOAuthBundle = vi.fn();
const writeOAuthBundle = vi.fn();
const readConfig = vi.fn();
const codexModels = vi.fn();
const ensureFreshCodex = vi.fn();

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn(async () => true) }));
vi.mock("@/lib/models", () => ({ listModels: (...args: unknown[]) => listModels(...args) }));
vi.mock("@/lib/config/store", () => ({
  readOAuthBundle: (...args: unknown[]) => readOAuthBundle(...args),
  writeOAuthBundle: (...args: unknown[]) => writeOAuthBundle(...args),
  readConfig: (...args: unknown[]) => readConfig(...args),
  safeProviderId: (value: string) => value,
}));
vi.mock("@/lib/ai/oauth/codex", () => ({
  codexModels: (...args: unknown[]) => codexModels(...args),
  ensureFreshCodex: (...args: unknown[]) => ensureFreshCodex(...args),
}));

describe("/api/models dynamic pricing and provider mapping", () => {
  beforeEach(() => {
    vi.mocked(requireSession).mockReset().mockResolvedValue(true);
    listModels.mockReset().mockResolvedValue([
      {
        ref: "zhipuai/glm-free",
        provider: "zhipuai",
        name: "GLM Free",
        cost: { input: 0, output: 0 },
        limit: { context: 128000 },
        tool_call: true,
        reasoning: true,
      },
      {
        ref: "zhipuai/glm-paid",
        provider: "zhipuai",
        name: "GLM Paid",
        cost: { input: 1, output: 2 },
        tool_call: true,
      },
      {
        ref: "zhipuai/glm-unknown",
        provider: "zhipuai",
        name: "GLM Unknown",
        tool_call: true,
      },
    ]);
    readOAuthBundle.mockReset().mockResolvedValue(null);
    writeOAuthBundle.mockReset();
    readConfig.mockReset().mockResolvedValue({});
    codexModels.mockReset();
    ensureFreshCodex.mockReset();
  });

  it("maps a runtime provider through catalogId and preserves the runtime slug in results", async () => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/models?provider=glm"));
    const body = await res.json();
    expect(body.models).toHaveLength(3);
    expect(body.models[0]).toMatchObject({
      provider: "glm",
      ref: "glm/glm-free",
      id: "glm-free",
      free: true,
      agentReady: true,
    });
    expect(body.models.find((m: { id: string }) => m.id === "glm-unknown")).toMatchObject({ free: false });
  });

  it("free=1 returns only explicit zero-input and zero-output models", async () => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/models?provider=glm&free=1"));
    const body = await res.json();
    expect(body.models.map((m: { id: string }) => m.id)).toEqual(["glm-free"]);
  });

  // Regression: the route extraction turned `provider: runtimeProvider` into the
  // shorthand `provider`, so an unfiltered catalog reported every model as null.
  it("names each model's real provider when no provider filter is passed", async () => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/models"));
    const body = await res.json();
    const rows = body.models.filter((m: { id: string }) => m.id === "glm-free");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.provider).toBe("zhipuai");
      expect(row.ref).toBe("zhipuai/glm-free");
    }
  });

  it("returns a custom provider's declared ids instead of an empty catalog", async () => {
    readConfig.mockResolvedValue({
      customProviders: { "my-llm": { baseUrl: "https://gw.example/v1", models: ["b", "a"] } },
    });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/models?provider=my-llm"));
    const body = await res.json();
    expect(body.models).toEqual([
      { ref: "my-llm/b", provider: "my-llm", id: "b", name: "b", free: false, agentReady: false },
      { ref: "my-llm/a", provider: "my-llm", id: "a", name: "a", free: false, agentReady: false },
    ]);
    expect(listModels).not.toHaveBeenCalled();
  });

  it("keeps a custom provider free query empty (no models.dev pricing)", async () => {
    readConfig.mockResolvedValue({
      customProviders: { "my-llm": { baseUrl: "https://gw.example/v1", models: ["a"] } },
    });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/models?provider=my-llm&free=1"));
    expect((await res.json()).models).toEqual([]);
  });

  it("falls back to the catalog when the provider is not custom", async () => {
    readConfig.mockResolvedValue({ customProviders: { other: { baseUrl: "https://gw.example/v1" } } });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/models?provider=glm"));
    expect((await res.json()).models).toHaveLength(3);
    expect(listModels).toHaveBeenCalled();
  });

  it.each(["openai-codex", "glm", ""])("requires an owner before any provider access (%s)", async (provider) => {
    vi.mocked(requireSession).mockResolvedValue(false);
    const { GET } = await import("./route");
    const res = await GET(new NextRequest(`http://localhost/api/models?provider=${provider}&free=1`));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(requireSession).toHaveBeenCalledWith("owner");
    expect(listModels).not.toHaveBeenCalled();
    expect(readOAuthBundle).not.toHaveBeenCalled();
    expect(writeOAuthBundle).not.toHaveBeenCalled();
    expect(readConfig).not.toHaveBeenCalled();
    expect(ensureFreshCodex).not.toHaveBeenCalled();
    expect(codexModels).not.toHaveBeenCalled();
  });
});
