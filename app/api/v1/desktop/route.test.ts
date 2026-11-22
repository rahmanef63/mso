// Route-level contract: the gate fires before any host work, an injection attempt
// is refused with a 400 and never reaches docker, and the PNG response carries the
// headers that keep bytes from being treated as a document.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async () => true),
  actor: vi.fn(async () => "operator-device" as string | null),
  rateLimited: vi.fn(() => false),
  list: vi.fn(async () => [] as unknown[]),
  screenshot: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  lifecycle: vi.fn(async (): Promise<Record<string, unknown>> => ({ action: "stop", container: "grokbot-manef", state: null })),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionActor: mocks.actor }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited }));
vi.mock("@/lib/host/audit-api", () => ({ audit: mocks.audit }));
vi.mock("@/lib/desktop/observer", async () => {
  // The real validators are pure and are part of what is under test; only the
  // docker callers are replaced.
  const actual = await vi.importActual<typeof import("@/lib/desktop/observer")>("@/lib/desktop/observer");
  return {
    ...actual,
    listDesktopContainers: mocks.list,
    screenshotDesktop: mocks.screenshot,
    desktopLifecycle: mocks.lifecycle,
  };
});

const { GET: containers } = await import("@/app/api/v1/desktop/containers/route");
const { GET: screenshot } = await import("@/app/api/v1/desktop/screenshot/route");
const { POST: lifecycle } = await import("@/app/api/v1/desktop/lifecycle/route");
const { HostError } = await import("@/lib/host/host-error");

const URL_BASE = "https://mso.example/api/v1/desktop";

function post(body: unknown): Request {
  return new Request(`${URL_BASE}/lifecycle`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mocks.verifyAuth.mockReset().mockResolvedValue(true);
  mocks.actor.mockReset().mockResolvedValue("operator-device");
  mocks.rateLimited.mockReset().mockReturnValue(false);
  mocks.list.mockReset().mockResolvedValue([]);
  mocks.screenshot.mockReset().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  mocks.lifecycle.mockReset().mockResolvedValue({ action: "stop", container: "grokbot-manef", state: null });
  mocks.audit.mockReset().mockResolvedValue(undefined);
});

describe("auth precedes host work on every verb", () => {
  it("refuses an unauthenticated caller without listing or touching docker", async () => {
    mocks.verifyAuth.mockResolvedValue(false);
    expect((await containers(new Request(`${URL_BASE}/containers`))).status).toBe(401);
    expect((await screenshot(new Request(`${URL_BASE}/screenshot?container=a1b2c3d4e5f6&screen=99`))).status).toBe(401);
    expect((await lifecycle(post({ container: "a1b2c3d4e5f6", action: "stop" }))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.screenshot).not.toHaveBeenCalled();
    expect(mocks.lifecycle).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rate-limits before the host call", async () => {
    mocks.rateLimited.mockReturnValue(true);
    expect((await containers(new Request(`${URL_BASE}/containers`))).status).toBe(429);
    expect((await lifecycle(post({ container: "a1b2c3d4e5f6", action: "stop" }))).status).toBe(429);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });
});

describe("container list", () => {
  it("wraps the inventory and never caches it", async () => {
    mocks.list.mockResolvedValue([{ id: "a1b2c3d4e5f6", name: "grokbot-manef" }]);
    const response = await containers(new Request(`${URL_BASE}/containers`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ containers: [{ id: "a1b2c3d4e5f6", name: "grokbot-manef" }] });
  });

  it("does not turn a docker failure into an empty list", async () => {
    mocks.list.mockRejectedValue(new HostError("Docker is not available to the MSO service user", 503));
    const response = await containers(new Request(`${URL_BASE}/containers`));
    expect(response.status).toBe(503);
  });
});

describe("screenshot", () => {
  it("returns PNG bytes with a non-sniffable content type", async () => {
    const response = await screenshot(
      new Request(`${URL_BASE}/screenshot?container=a1b2c3d4e5f6&screen=99`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response.arrayBuffer()).byteLength).toBe(4);
    expect(mocks.screenshot).toHaveBeenCalledWith("a1b2c3d4e5f6", "99");
  });

  it("requires a container", async () => {
    const response = await screenshot(new Request(`${URL_BASE}/screenshot?screen=99`));
    expect(response.status).toBe(400);
    expect(mocks.screenshot).not.toHaveBeenCalled();
  });

  it("refuses an injection in the container id at the HTTP boundary", async () => {
    const response = await screenshot(
      new Request(`${URL_BASE}/screenshot?container=${encodeURIComponent("abc; rm -rf /")}&screen=99`),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("root:");
  });
});

describe("lifecycle", () => {
  it("runs an allowlisted verb and audits it with the actor", async () => {
    const response = await lifecycle(post({ container: "a1b2c3d4e5f6", action: "stop" }));
    expect(response.status).toBe(200);
    expect(mocks.lifecycle).toHaveBeenCalledWith("a1b2c3d4e5f6", "stop", { lines: undefined });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "desktop.lifecycle", actor: "operator-device", ok: true, detail: "stop" }),
    );
  });

  it("passes a bounded tail for logs and nothing else", async () => {
    mocks.lifecycle.mockResolvedValue({ action: "logs", container: "grokbot-manef", state: null, logs: ["ok"] });
    const response = await lifecycle(post({ container: "a1b2c3d4e5f6", action: "logs", lines: 20 }));
    expect(response.status).toBe(200);
    expect(mocks.lifecycle).toHaveBeenCalledWith("a1b2c3d4e5f6", "logs", { lines: 20 });
  });

  it("rejects every action that is not in the allowlist", async () => {
    for (const action of ["exec", "run", "shell", "bash", "create", "rm", "kill", "start; rm -rf /"]) {
      const response = await lifecycle(post({ container: "a1b2c3d4e5f6", action }));
      expect(response.status, action).toBe(400);
    }
    expect(mocks.lifecycle).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed container before the host call", async () => {
    for (const body of [{ action: "stop" }, { container: "", action: "stop" }, { container: "abc; rm -rf /", action: "stop" }]) {
      expect((await lifecycle(post(body))).status).toBe(400);
    }
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric lines value", async () => {
    const response = await lifecycle(post({ container: "a1b2c3d4e5f6", action: "logs", lines: "500" }));
    expect(response.status).toBe(400);
    expect(mocks.lifecycle).not.toHaveBeenCalled();
  });

  it("rejects a malformed body without throwing", async () => {
    const response = await lifecycle(
      new Request(`${URL_BASE}/lifecycle`, { method: "POST", body: "not json", headers: { "content-type": "application/json" } }),
    );
    expect(response.status).toBe(400);
  });

  it("audits a failure with ok:false so a refused action is still visible", async () => {
    mocks.lifecycle.mockRejectedValue(new HostError("No bot desktop container with that id", 404));
    const response = await lifecycle(post({ container: "a1b2c3d4e5f6", action: "stop" }));
    expect(response.status).toBe(404);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ ok: false, detail: expect.stringContaining("No bot desktop") }));
  });
});
