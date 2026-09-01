import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveModelRef = vi.fn();
const readOAuthBundle = vi.fn();
const writeOAuthBundle = vi.fn();
const codexModels = vi.fn();
const ensureFreshCodex = vi.fn();

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn(async () => true) }));
vi.mock("@/lib/config/store", () => ({
  resolveModelRef: (...args: unknown[]) => resolveModelRef(...args),
  readOAuthBundle: (...args: unknown[]) => readOAuthBundle(...args),
  writeOAuthBundle: (...args: unknown[]) => writeOAuthBundle(...args),
  hostCredentialStore: vi.fn(() => ({})),
  selectedCustomConn: vi.fn(async () => null),
}));
vi.mock("@/lib/ai/oauth/codex", () => ({
  codexModels: (...args: unknown[]) => codexModels(...args),
  ensureFreshCodex: (...args: unknown[]) => ensureFreshCodex(...args),
}));
vi.mock("@/lib/models", () => ({ resolveModel: vi.fn() }));
vi.mock("@/lib/host/ssrf", () => ({ safeProviderFetch: vi.fn() }));

describe("/api/models/test OpenAI Codex OAuth", () => {
  beforeEach(() => {
    resolveModelRef.mockReset().mockResolvedValue("openai-codex/gpt-5.6-sol");
    const bundle = { kind: "oauth", access: "x", expires: Date.now() + 999999 };
    readOAuthBundle.mockReset().mockResolvedValue(bundle);
    ensureFreshCodex.mockReset().mockResolvedValue(bundle);
    codexModels.mockReset().mockResolvedValue(["gpt-5.6-sol", "gpt-5.6-terra"]);
    writeOAuthBundle.mockReset().mockResolvedValue(undefined);
  });

  it("validates the selected subscription model via the account model list", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    expect(await res.json()).toEqual({ ok: true, provider: "openai-codex", model: "gpt-5.6-sol" });
    expect(codexModels).toHaveBeenCalled();
  });

  it("reports a selected model that the account does not expose", async () => {
    codexModels.mockResolvedValueOnce(["gpt-5.6-terra"]);
    const { POST } = await import("./route");
    const res = await POST();
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining("not available") });
  });
});
