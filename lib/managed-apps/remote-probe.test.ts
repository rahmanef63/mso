import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./runner", () => ({ commandExists: vi.fn(), runProgram: vi.fn() }));

import { runRemoteProbe } from "./remote-probe";
import { commandExists } from "./runner";

describe("runRemoteProbe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(commandExists).mockResolvedValue(true);
  });

  it("blocks private IPs and shared-cookie origins on https-url mode", async () => {
    const priv = await runRemoteProbe({ mode: "https-url", url: "https://127.0.0.1:5678" }, "https://mso.example.test");
    expect(priv.ok).toBe(false);
    expect(priv.summary).toMatch(/Private\/loopback/i);

    const sameOrigin = await runRemoteProbe({ mode: "https-url", url: "https://mso.example.test/n8n" }, "https://mso.example.test");
    expect(sameOrigin.ok).toBe(false);
    expect(sameOrigin.summary).toMatch(/cookie/i);
  });

  it("recommends new-tab mode when remote HTTPS server sends X-Frame-Options: DENY", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { "x-frame-options": "DENY" } })));
    const result = await runRemoteProbe({ mode: "https-url", url: "https://n8n.other.test" }, "https://mso.example.test");
    expect(result.ok).toBe(true);
    expect(result.recommendation?.embedMode).toBe("remote");
  });

  it("rejects non-loopback targets and home-escaping dataDir on local-existing mode", async () => {
    const offBox = await runRemoteProbe({ mode: "local-existing", endpoint: "http://192.168.1.99:5678" }, "https://mso.example.test");
    expect(offBox.ok).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    const escaped = await runRemoteProbe({ mode: "local-existing", endpoint: "http://127.0.0.1:5678", dataDir: "/etc/passwd" }, "https://mso.example.test");
    expect(escaped.ok).toBe(false);
    expect(escaped.checks.some((c) => c.label === "Data directory" && c.status === "error")).toBe(true);
  });

  it("validates SSH host/key containment and produces a safe loopback tunnel command", async () => {
    const badHost = await runRemoteProbe({ mode: "ssh-tunnel", sshUser: "ubuntu", sshHost: "-oProxyCommand=evil", remotePort: 5678 }, "https://mso.example.test");
    expect(badHost.ok).toBe(false);

    const badKey = await runRemoteProbe({ mode: "ssh-tunnel", sshUser: "ubuntu", sshHost: "192.168.1.50", remotePort: 5678, identityFile: "/etc/shadow" }, "https://mso.example.test");
    expect(badKey.ok).toBe(false);

    const good = await runRemoteProbe({ mode: "ssh-tunnel", sshUser: "ubuntu", sshHost: "192.168.1.50", sshPort: 2222, remotePort: 5678, localPort: 15678 }, "https://mso.example.test");
    expect(good.ok).toBe(true);
    expect(good.recommendation?.tunnelCommand).toContain("ssh -N -L 127.0.0.1:15678:127.0.0.1:5678 -p 2222 ubuntu@192.168.1.50");
  });
});
