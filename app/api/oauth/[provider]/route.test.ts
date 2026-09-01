import { beforeEach, describe, expect, it, vi } from "vitest";

const writeConfig = vi.fn();
const writeOAuthBundle = vi.fn();
const clearFlow = vi.fn();
const getFlow = vi.fn();
const codexPoll = vi.fn();

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn(async () => true) }));
vi.mock("@/lib/config/store", () => ({
  writeConfig: (...args: unknown[]) => writeConfig(...args),
  writeOAuthBundle: (...args: unknown[]) => writeOAuthBundle(...args),
}));
vi.mock("@/lib/ai/oauth/codex", () => ({
  CODEX: { verificationUrl: "https://example.com/device" },
  codexStart: vi.fn(async () => ({ deviceAuthId: "dev-auth", userCode: "ABCD", intervalMs: 3000 })),
  codexPoll: (...args: unknown[]) => codexPoll(...args),
  codexModels: vi.fn(async () => ["gpt-account-model"]),
}));
vi.mock("@/lib/ai/oauth/flow-state", () => ({
  setFlow: vi.fn(),
  getFlow: (...args: unknown[]) => getFlow(...args),
  clearFlow: (...args: unknown[]) => clearFlow(...args),
}));

const request = (body: unknown) => new Request("http://localhost/api/oauth/openai", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}) as never;
const ctx = { params: Promise.resolve({ provider: "openai" }) };

describe("OpenAI Codex OAuth selection semantics", () => {
  beforeEach(() => {
    writeConfig.mockReset().mockResolvedValue(undefined);
    writeOAuthBundle.mockReset().mockResolvedValue(undefined);
    clearFlow.mockReset();
    getFlow.mockReset().mockReturnValue({ deviceAuthId: "dev-auth", userCode: "ABCD" });
    codexPoll.mockReset().mockResolvedValue({ bundle: { access: "token" } });
  });

  it("stores OAuth credentials but preserves active model when select:false", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ action: "poll", select: false }), ctx);
    expect(res.status).toBe(200);
    expect(writeOAuthBundle).toHaveBeenCalled();
    expect(writeConfig).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ slug: "openai-codex", selected: false, model: "gpt-account-model" });
  });

  it("keeps existing callers selecting the OAuth provider when select is omitted", async () => {
    const { POST } = await import("./route");
    await POST(request({ action: "poll" }), ctx);
    expect(writeConfig).toHaveBeenCalledWith({ provider: "openai-codex", model: "gpt-account-model" });
  });
});
