import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: vi.fn() }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: vi.fn(() => false) }));
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));
vi.mock("@/lib/managed-apps/ssh-tunnel", () => ({
  listSshTunnels: vi.fn(),
  saveSshTunnel: vi.fn(),
  startSshTunnel: vi.fn(),
  stopSshTunnel: vi.fn(),
  deleteSshTunnel: vi.fn(),
}));

import { getSessionContext } from "@/lib/auth/require-session";
import { listSshTunnels, saveSshTunnel } from "@/lib/managed-apps/ssh-tunnel";
import { GET, POST } from "./route";

describe("/api/v1/managed-apps/tunnels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires owner authorization for GET and POST", async () => {
    vi.mocked(getSessionContext).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    vi.mocked(getSessionContext).mockResolvedValue({ session: { device_id: "op" }, role: "operator" } as never);
    expect((await GET()).status).toBe(403);
    expect((await POST(new Request("https://mso.example.test/api/v1/managed-apps/tunnels", { method: "POST", body: "{}" }))).status).toBe(403);
  });

  it("lists and saves tunnels for owner", async () => {
    vi.mocked(getSessionContext).mockResolvedValue({ session: { device_id: "own" }, role: "owner" } as never);
    vi.mocked(listSshTunnels).mockResolvedValue({ schemaVersion: 1, sshAvailable: true, tunnels: [] });
    vi.mocked(saveSshTunnel).mockResolvedValue({
      id: "n8n-remote", appId: "n8n", title: "Remote n8n", sshUser: "ubuntu", sshHost: "192.168.1.10",
      sshPort: 22, remotePort: 5678, localPort: 15678, createdAt: "", updatedAt: "", active: false, pid: null,
      localUrl: "http://127.0.0.1:15678", error: null,
    });
    expect((await GET()).status).toBe(200);
    const res = await POST(new Request("https://mso.example.test/api/v1/managed-apps/tunnels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", id: "n8n-remote", appId: "n8n", title: "Remote n8n", sshUser: "ubuntu", sshHost: "192.168.1.10", remotePort: 5678, localPort: 15678 }),
    }));
    expect(res.status).toBe(200);
    expect(saveSshTunnel).toHaveBeenCalledOnce();
  });
});
