// Route-level regression for the `mso ai` failure mode that shipped as a bare 500:
// the CLI posted OpenAI-shaped `{role:"user",content}` while OaMsg carries `text`,
// so the prompt was dropped before recall() and before the streamer. PR #133 fixed
// the route by normalizing at the trust boundary; this test locks that behavior at
// the boundary rather than only inside recall().
import { describe, expect, it, vi } from "vitest";

const stableContext = {
  session: { device_id: "normalize-content-device", issued_at: 1, expires_at: 2, cookie_scope: "host", cookie_epoch: "epoch-0000000000000000" },
  device: { label: "test owner", approvedAt: 1, role: "owner" as const },
  role: "owner" as const,
};

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => stableContext),
}));

vi.mock("@/lib/config/store", () => ({
  DEFAULT_PROVIDER: "anthropic",
  readConfig: vi.fn(async () => ({})),
  resolveModelRef: vi.fn(async () => "anthropic/claude-test"),
  hostCredentialStore: vi.fn(() => ({ getKey: async () => "", setKey: async () => {}, deleteKey: async () => {} })),
  selectedCustomConn: vi.fn(async () => null),
  readOAuthBundle: vi.fn(async () => null),
  writeOAuthBundle: vi.fn(async () => {}),
}));

vi.mock("@/lib/demo", () => ({ IS_DEMO: false }));

// The provider round-trip is not under test; the normalized messages handed to it are.
const streamed: unknown[][] = [];
vi.mock("@/lib/ai/selected-model-stream", () => ({
  SelectedModelConfigError: class SelectedModelConfigError extends Error {},
  prepareSelectedModel: vi.fn(async () => ({ ref: "test/model" })),
  streamPreparedSelectedModel: vi.fn(
    async ({ messages, emit }: { messages: unknown[]; emit: (event: string, data: unknown) => void }) => {
      streamed.push(messages);
      emit("delta", "OK");
      emit("done", { stopReason: "end_turn" });
    },
  ),
}));

vi.mock("@/lib/agent/legacy-owner-memory", () => ({
  recall: vi.fn(async () => []),
}));

function makeReq(messages: unknown[]): Request {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    body: JSON.stringify({ messages }),
    headers: { "content-type": "application/json" },
  });
}

describe("/api/assistant OpenAI-shaped message normalization", () => {
  it("turns a user {content} into {text} so the prompt reaches recall and the streamer", async () => {
    const memory = await import("@/lib/agent/legacy-owner-memory");
    const { POST } = await import("./route");

    const res = await POST(makeReq([{ role: "user", content: "halo dari CLI" }]));

    expect(res.status).toBe(200);
    expect(memory.recall).toHaveBeenLastCalledWith("halo dari CLI");
    expect(streamed.at(-1)).toEqual([{ role: "user", content: "halo dari CLI", text: "halo dari CLI" }]);
    await expect(res.text()).resolves.toContain("event: delta");
  });

  it("leaves an OaMsg {text} message untouched", async () => {
    const memory = await import("@/lib/agent/legacy-owner-memory");
    const { POST } = await import("./route");

    const res = await POST(makeReq([{ role: "user", text: "halo mso" }]));

    expect(res.status).toBe(200);
    expect(memory.recall).toHaveBeenLastCalledWith("halo mso");
    expect(streamed.at(-1)).toEqual([{ role: "user", text: "halo mso" }]);
  });

  it("streams instead of failing when neither shape carries a usable prompt", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeReq([{ role: "user", content: [{ type: "text", text: "blok" }] }]));

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain("event: delta");
  });
});
