// Integration tests for /api/v1/exec/run — the privileged shell endpoint.
// Mocks the auth gate, actor session, and runCommand so we exercise ONLY the
// route's wiring: auth → rate-limit → JSON validation → destructive check →
// audit + response shaping. Real runCommand is covered by lib/host/fs.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/server", () => ({
  verifyAuth: vi.fn(async () => true),
}));

// Each test sets a unique actor so the rate-limit bucket (process-singleton
// Map keyed by `exec:${actor}`) doesn't leak between cases.
const actorRef = { current: "test-actor-default" };
vi.mock("@/lib/auth/require-session", () => ({
  getSessionActor: vi.fn(async () => actorRef.current),
}));

// The destructive guard lives inside runCommand (lib/host/exec.ts), so the
// route delegates to it. We stub the host index to simulate each outcome.
const runCommandMock = vi.fn();
const auditMock = vi.fn();
vi.mock("@/lib/host/exec-api", () => ({
  runCommand: (...args: unknown[]) => runCommandMock(...args),
}));
vi.mock("@/lib/host/audit-api", () => ({
  audit: (...args: unknown[]) => auditMock(...args),
}));

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/v1/exec/run", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("/api/v1/exec/run", () => {
  beforeEach((ctx) => {
    actorRef.current = `actor-${ctx.task.id}`;
    runCommandMock.mockReset();
    auditMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 200 with stdout for an authenticated safe command", async () => {
    runCommandMock.mockResolvedValueOnce({ stdout: "hi\n", stderr: "", code: 0 });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ cmd: "echo hi" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stdout).toBe("hi\n");
    expect(body.code).toBe(0);
    expect(runCommandMock).toHaveBeenCalledWith("echo hi", undefined);
  });

  it("returns 401 when verifyAuth rejects the caller", async () => {
    const { verifyAuth } = await import("@/lib/agent/server");
    vi.mocked(verifyAuth).mockResolvedValueOnce(false);
    const { POST } = await import("./route");
    const res = await POST(makeReq({ cmd: "echo hi" }));
    expect(res.status).toBe(401);
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("returns 200 with code 126 + 'refused:' stderr for destructive commands", async () => {
    // The route doesn't itself reject destructive — runCommand returns the
    // signed refusal envelope (stderr "refused: …", code 126) which the route
    // then logs as audit.action=exec.blocked. We assert that mapping.
    runCommandMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "refused: rm -rf on /. Run it over SSH if you really mean it.",
      code: 126,
    });
    const { POST } = await import("./route");
    const res = await POST(makeReq({ cmd: "rm -rf /" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(126);
    expect(body.stderr).toMatch(/^refused:/);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "exec.blocked", ok: false }),
    );
  });

  it("returns 429 when burst limit exceeds 60 hits in 60s", async () => {
    runCommandMock.mockResolvedValue({ stdout: "", stderr: "", code: 0 });
    const { POST } = await import("./route");
    // 60 within window pass; 61st trips.
    for (let i = 0; i < 60; i++) {
      const res = await POST(makeReq({ cmd: "true" }));
      expect(res.status).not.toBe(429);
    }
    const limited = await POST(makeReq({ cmd: "true" }));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error).toMatch(/Too many/i);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "exec.run", ok: false, detail: "rate-limited" }),
    );
  });

  it("returns 400 when the cmd field is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect(runCommandMock).not.toHaveBeenCalled();
  });
});
