import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const listModels = vi.fn();
const readOAuthBundle = vi.fn();
const writeOAuthBundle = vi.fn();
const codexModels = vi.fn();
const ensureFreshCodex = vi.fn();

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn(async () => true) }));
vi.mock("@/lib/models", () => ({ listModels: (...args: unknown[]) => listModels(...args) }));
vi.mock("@/lib/config/store", () => ({
  readOAuthBundle: (...args: unknown[]) => readOAuthBundle(...args),
  writeOAuthBundle: (...args: unknown[]) => writeOAuthBundle(...args),
}));
vi.mock("@/lib/ai/oauth/codex", () => ({
  codexModels: (...args: unknown[]) => codexModels(...args),
  ensureFreshCodex: (...args: unknown[]) => ensureFreshCodex(...args),
}));

describe("/api/models dynamic pricing and provider mapping", () => {
  beforeEach(() => {
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
});
