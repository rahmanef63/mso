import { beforeEach, describe, expect, it, vi } from "vitest";

const contextRef: { current: null | { role: string; session: { device_id: string } } } = {
  current: { role: "owner", session: { device_id: "dev-owner" } },
};
const setMock = vi.fn();
const removeMock = vi.fn();
const auditMock = vi.fn();

vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: vi.fn(async () => contextRef.current),
}));
vi.mock("@/lib/host", () => ({ audit: (...args: unknown[]) => auditMock(...args) }));
vi.mock("@/lib/infra", () => ({
  INFRA_PROVIDER_IDS: ["dokploy", "cloudflare", "hostinger"],
  isInfraProviderId: (id: string) => ["dokploy", "cloudflare", "hostinger"].includes(id),
  readInfraProvider: vi.fn(async () => ({})),
  removeInfraProvider: (...args: unknown[]) => removeMock(...args),
  setInfraProvider: (...args: unknown[]) => setMock(...args),
  summarizeInfraProvider: (id: string, values: Record<string, string>) => ({ id, configured: Boolean(Object.keys(values).length), values }),
}));

const postReq = (body: unknown) => new Request("http://localhost/api/v1/infra/providers", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}) as never;

describe("/api/v1/infra/providers", () => {
  beforeEach(() => {
    contextRef.current = { role: "owner", session: { device_id: "dev-owner" } };
    setMock.mockReset(); removeMock.mockReset(); auditMock.mockReset();
    setMock.mockResolvedValue({ apiUrl: "https://panel.example.com/api", apiKey: "masked-by-summary" });
    removeMock.mockResolvedValue(undefined);
  });

  it("rejects non-owner configuration", async () => {
    contextRef.current = { role: "operator", session: { device_id: "dev-op" } };
    const { POST } = await import("./route");
    const res = await POST(postReq({ id: "dokploy", values: {} }));
    expect(res.status).toBe(401);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("stores only a known provider and writes an actor-attributed audit event", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ id: "dokploy", values: { apiUrl: "https://panel.example.com" } }));
    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith("dokploy", { apiUrl: "https://panel.example.com" });
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "infra.write", actor: "dev-owner", target: "dokploy", detail: "provider.configure" }));
  });

  it("fails closed on unknown providers", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ id: "random-cloud", values: { token: "x" } }));
    expect(res.status).toBe(404);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("audits failed provider configuration without returning a secret", async () => {
    setMock.mockRejectedValueOnce(new Error("Cloudflare API token is invalid"));
    const { POST } = await import("./route");
    const res = await POST(postReq({ id: "cloudflare", values: { apiToken: "not-shown" } }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("not-shown");
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "infra.write", target: "cloudflare", ok: false }));
  });
});
