import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveModelRef = vi.fn();
const readOAuthBundle = vi.fn();
const writeOAuthBundle = vi.fn();
const codexModels = vi.fn();
const ensureFreshCodex = vi.fn();
const streamCodex = vi.fn();
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
vi.mock("@/lib/ai/codex-stream", () => ({ streamCodex: (...args: unknown[]) => streamCodex(...args) }));
vi.mock("@/lib/models", () => ({ resolveModel: vi.fn() }));
vi.mock("@/lib/host/ssrf", () => ({ safeProviderFetch: vi.fn() }));

describe("/api/models/test OpenAI Codex OAuth", () => {
  it("requires Owner before reading configuration or sending an inference request", async () => {
    const { requireSession } = await import("@/lib/auth/require-session");
    vi.mocked(requireSession).mockResolvedValueOnce(false);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { POST } = await import("./route");
    expect((await POST()).status).toBe(401);
    expect(requireSession).toHaveBeenCalledWith("owner");
    expect(resolveModelRef).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("sends only the selected model and static ping through the custom-provider guard", async () => {
    resolveModelRef.mockResolvedValue("fixture/model");
    const { selectedCustomConn } = await import("@/lib/config/store");
    vi.mocked(selectedCustomConn).mockResolvedValueOnce({ baseUrl: "https://fixture.invalid/v1" });
    const { resolveModel } = await import("@/lib/models");
    vi.mocked(resolveModel).mockResolvedValue({ protocol: "openai", baseUrl: "https://fixture.invalid/v1", apiKey: "synthetic", provider: "fixture", model: "model", privateFileData: "must stay local" } as never);
    const { safeProviderFetch } = await import("@/lib/host/ssrf");
    vi.mocked(safeProviderFetch).mockResolvedValueOnce(new Response());
    const { POST } = await import("./route");
    expect((await (await POST()).json()).ok).toBe(true);
    const [url, request] = vi.mocked(safeProviderFetch).mock.calls.at(-1)!;
    expect(url).toBe("https://fixture.invalid/v1/chat/completions");
    expect(JSON.parse(request!.body as string)).toEqual({ model: "model", max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
  });
  it("bounds custom-provider error bodies and applies a deadline before fetching", async () => {
    resolveModelRef.mockResolvedValue("fixture/model");
    const { resolveModel } = await import("@/lib/models");
    vi.mocked(resolveModel).mockResolvedValue({ protocol: "openai", baseUrl: "https://fixture.invalid/v1", apiKey: "synthetic", provider: "fixture", model: "model" } as never);
    const cancel = vi.fn();
    const fetch = vi.fn(async (_url, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode("denied ".repeat(1000))); }, cancel }), { status: 401 });
    });
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("./route");
    const response = await (await POST()).json();
    expect(response.ok).toBe(false); expect(response.error.length).toBeLessThan(160); expect(cancel).toHaveBeenCalled();
  });
  it("releases an unused successful connection-test response body", async () => {
    resolveModelRef.mockResolvedValue("fixture/model");
    const { resolveModel } = await import("@/lib/models");
    vi.mocked(resolveModel).mockResolvedValue({ protocol: "openai", baseUrl: "https://fixture.invalid/v1", apiKey: "synthetic", provider: "fixture", model: "model" } as never);
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }))));
    const { POST } = await import("./route");
    expect((await (await POST()).json()).ok).toBe(true); expect(cancel).toHaveBeenCalled();
  });
  beforeEach(() => {
    resolveModelRef.mockReset().mockResolvedValue("openai-codex/gpt-5.6-sol");
    const bundle = { kind: "oauth", access: "x", expires: Date.now() + 999999 };
    readOAuthBundle.mockReset().mockResolvedValue(bundle);
    ensureFreshCodex.mockReset().mockResolvedValue(bundle);
    codexModels.mockReset().mockResolvedValue(["gpt-5.6-sol", "gpt-5.6-terra"]);
    writeOAuthBundle.mockReset().mockResolvedValue(undefined);
    streamCodex.mockReset().mockImplementation(async ({ emit }) => {
      emit("delta", "OK");
      emit("done", { stopReason: "end_turn" });
    });
  });

  it("validates the selected subscription model with a real streaming request", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    expect(await res.json()).toEqual({ ok: true, provider: "openai-codex", model: "gpt-5.6-sol" });
    expect(codexModels).toHaveBeenCalled();
    expect(streamCodex).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-sol",
      messages: [{ role: "user", text: "Reply with OK only." }],
      signal: expect.any(AbortSignal),
    }));
  });

  it("reports a selected model that the account does not expose", async () => {
    codexModels.mockResolvedValueOnce(["gpt-5.6-terra"]);
    const { POST } = await import("./route");
    const res = await POST();
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining("not available") });
    expect(streamCodex).not.toHaveBeenCalled();
  });

  it("does not report ready when inference fails despite model-list access", async () => {
    streamCodex.mockRejectedValueOnce(new Error("openai-codex HTTP 429"));
    const { POST } = await import("./route");
    expect(await (await POST()).json()).toEqual({ ok: false, error: "openai-codex HTTP 429" });
  });

  it("rejects empty or unfinished streams", async () => {
    const { POST } = await import("./route");
    for (const events of [["done"], ["delta"]]) {
      streamCodex.mockImplementationOnce(async ({ emit }) => {
        for (const event of events) emit(event, event === "delta" ? "OK" : { stopReason: "end_turn" });
      });
      expect(await (await POST()).json()).toEqual({ ok: false, error: "OpenAI ChatGPT returned no completed reply" });
    }
  });
});
