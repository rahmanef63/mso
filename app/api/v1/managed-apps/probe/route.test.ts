import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: vi.fn() }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: vi.fn(() => false) }));
vi.mock("@/lib/managed-apps/remote-probe", () => ({ runRemoteProbe: vi.fn() }));

import { getSessionContext } from "@/lib/auth/require-session";
import { runRemoteProbe } from "@/lib/managed-apps/remote-probe";
import { POST } from "./route";

const makeRequest = (body: unknown) =>
  new Request("https://mso.example.test/api/v1/managed-apps/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/v1/managed-apps/probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires owner session", async () => {
    vi.mocked(getSessionContext).mockResolvedValue(null);
    expect((await POST(makeRequest({ mode: "https-url", url: "https://n8n.example.test" }))).status).toBe(401);

    vi.mocked(getSessionContext).mockResolvedValue({ session: { device_id: "op" }, role: "operator" } as never);
    expect((await POST(makeRequest({ mode: "https-url", url: "https://n8n.example.test" }))).status).toBe(403);
  });

  it("validates payload and forwards to runRemoteProbe", async () => {
    vi.mocked(getSessionContext).mockResolvedValue({ session: { device_id: "own" }, role: "owner" } as never);
    expect((await POST(makeRequest({ mode: "unknown" }))).status).toBe(400);

    vi.mocked(runRemoteProbe).mockResolvedValue({ ok: true, mode: "https-url", summary: "ok", checks: [] });
    const res = await POST(makeRequest({ mode: "https-url", url: "https://n8n.example.test" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, mode: "https-url" });
  });
});
