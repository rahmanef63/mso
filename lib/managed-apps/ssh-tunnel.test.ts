import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runner", () => ({ commandExists: vi.fn(async () => true) }));

import { buildSshTunnelArgv, deleteSshTunnel, listSshTunnels, saveSshTunnel } from "./ssh-tunnel";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-tunnels-"));
  process.env.MSO_REMOTE_TUNNELS_FILE = path.join(tempDir, "remote-tunnels.json");
});

afterEach(async () => {
  delete process.env.MSO_REMOTE_TUNNELS_FILE;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("ssh-tunnel store and fixed-argv builder", () => {
  it("persists private tunnel records and rejects duplicate local ports or escaped keys", async () => {
    const saved = await saveSshTunnel({
      id: "n8n-vps",
      appId: "n8n",
      title: "VPS n8n",
      sshUser: "rahman",
      sshHost: "192.168.1.50",
      sshPort: 22,
      remotePort: 5678,
      localPort: 15678,
    });
    expect(saved.localUrl).toBe("http://127.0.0.1:15678");

    await expect(saveSshTunnel({
      id: "other-app",
      appId: "other",
      title: "Other",
      sshUser: "rahman",
      sshHost: "192.168.1.51",
      remotePort: 8080,
      localPort: 15678,
    })).rejects.toThrow(/already assigned/);

    await expect(saveSshTunnel({
      id: "bad-key",
      appId: "n8n",
      title: "Bad Key",
      sshUser: "rahman",
      sshHost: "192.168.1.51",
      remotePort: 5678,
      localPort: 15679,
      identityFile: "/etc/passwd",
    })).rejects.toThrow(/inside ~\/\.ssh/);

    const list = await listSshTunnels();
    expect(list.tunnels).toHaveLength(1);
    await deleteSshTunnel("n8n-vps");
    expect((await listSshTunnels()).tunnels).toHaveLength(0);
  });

  it("builds loopback-only fixed argv without shell interpolation", () => {
    const argv = buildSshTunnelArgv({
      id: "n8n-vps",
      appId: "n8n",
      title: "VPS n8n",
      sshUser: "rahman",
      sshHost: "10.0.0.5",
      sshPort: 2200,
      remotePort: 5678,
      localPort: 15678,
      createdAt: "",
      updatedAt: "",
    });
    expect(argv).toContain("-N");
    expect(argv).toContain("BatchMode=yes");
    expect(argv).toContain("127.0.0.1:15678:127.0.0.1:5678");
    expect(argv.at(-1)).toBe("rahman@10.0.0.5");
  });
});
