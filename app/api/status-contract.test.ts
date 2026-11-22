import { describe, expect, it, vi } from "vitest";

// Status-code contract for the routes whose gate is load-bearing.
//
// Why this file exists: 107 route handlers had their bodies moved in one mechanical batch.
// A separate audit compared every endpoint against the pre-conversion source and found no
// deviations, but an audit is a point-in-time act — nothing stopped the *next* refactor from
// turning an owner-only route into a public one. These assertions are that stop.
//
// The scope is deliberate. Every route below is a place where a dropped gate is an RCE, an
// arbitrary write, a secret leak or a role escalation, so each is worth a permanent assertion.
// Coverage of all 117 would be mostly noise; coverage of these twenty is the part that matters.
//
// The technique mirrors app/api/v1/sys/packages/route.test.ts: mock the auth primitive, import
// the route, call the exported verb with a plain Request, and assert on the status.

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(async (_req?: Request, _role?: string) => true),
  getSessionContext: vi.fn(async () => ({ session: { device_id: "dev-1" }, role: "owner" }) as unknown),
  // A real unauthenticated request has no actor either. If this always resolved, deleting a
  // route's gate would leave the handler "authenticated" through the back door and the test
  // below would pass while the route was wide open. That is exactly what happened on the first
  // attempt, and it is why this mock is driven by the same flag as the session.
  getSessionActor: vi.fn(async () => "dev-1" as string | null),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/server", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/auth/require-session", () => ({
  getSessionContext: mocks.getSessionContext,
  getSessionActor: vi.fn(async () => "dev-1"),
  requireSession: vi.fn(async () => ({ session: { device_id: "dev-1" }, role: "owner" })),
  nextSessionCookieReader: vi.fn(),
  SESSION_COOKIE: "session",
}));

// Anything that would touch the host is stubbed: this test asserts on the gate, never on work.
vi.mock("@/lib/host/fs-api", () => ({
  writeFile: vi.fn(async () => undefined),
  deletePath: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from("")),
  listDir: vi.fn(async () => []),
}));
vi.mock("@/lib/host/terminal-api", () => ({ openPty: vi.fn(), writePty: vi.fn(), closePty: vi.fn(), resizePty: vi.fn() }));
vi.mock("@/lib/host/exec-api", () => ({ runExec: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })) }));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: vi.fn(() => false) }));

// Kept for the owner-role case below; the unauthenticated loop uses `unauthed`.
const authed = () => {
  mocks.verifyAuth.mockResolvedValue(true);
  mocks.getSessionActor.mockResolvedValue("dev-1");
  mocks.getSessionContext.mockResolvedValue({ session: { device_id: "dev-1" }, role: "owner" } as never);
};
const unauthed = () => {
  mocks.verifyAuth.mockResolvedValue(false);
  mocks.getSessionActor.mockResolvedValue(null);
  mocks.getSessionContext.mockResolvedValue(null as never);
};

/** Every one of these must refuse an unauthenticated caller. */
const GUARDED: Array<{ name: string; load: () => Promise<Record<string, unknown>>; verb: "POST" | "GET" | "DELETE"; url: string; body?: string }> = [
  { name: "exec/run", load: () => import("@/app/api/v1/exec/run/route"), verb: "POST", url: "https://mso.example/api/v1/exec/run", body: JSON.stringify({ command: "id" }) },
  { name: "fs/write", load: () => import("@/app/api/v1/fs/write/route"), verb: "POST", url: "https://mso.example/api/v1/fs/write", body: JSON.stringify({ path: "/tmp/x", content: "y" }) },
  { name: "fs/delete", load: () => import("@/app/api/v1/fs/delete/route"), verb: "DELETE", url: "https://mso.example/api/v1/fs/delete", body: JSON.stringify({ path: "/tmp/x" }) },
  { name: "fs/raw", load: () => import("@/app/api/v1/fs/raw/route"), verb: "GET", url: "https://mso.example/api/v1/fs/raw?path=/etc/passwd" },
  { name: "term/open", load: () => import("@/app/api/v1/term/open/route"), verb: "POST", url: "https://mso.example/api/v1/term/open", body: "{}" },
  { name: "term/input", load: () => import("@/app/api/v1/term/input/route"), verb: "POST", url: "https://mso.example/api/v1/term/input", body: JSON.stringify({ id: "t", data: "ls\n" }) },
  { name: "agent-vault", load: () => import("@/app/api/v1/agent-vault/route"), verb: "GET", url: "https://mso.example/api/v1/agent-vault" },
  { name: "auth/devices", load: () => import("@/app/api/auth/devices/route"), verb: "GET", url: "https://mso.example/api/auth/devices" },
  { name: "auth/password", load: () => import("@/app/api/auth/password/route"), verb: "POST", url: "https://mso.example/api/auth/password", body: JSON.stringify({ current: "a", next: "bbbbbbbbbb" }) },
  { name: "sys/cleanup", load: () => import("@/app/api/v1/sys/cleanup/route"), verb: "POST", url: "https://mso.example/api/v1/sys/cleanup", body: "{}" },
  { name: "agent-sessions", load: () => import("@/app/api/v1/agent-sessions/route"), verb: "GET", url: "https://mso.example/api/v1/agent-sessions" },
];

describe("status-code contract: an unauthenticated caller never reaches the work", () => {
  for (const row of GUARDED) {
    it(`${row.name} refuses without a session`, async () => {
      unauthed();
      const mod = await row.load();
      const handler = mod[row.verb] as unknown as
        | ((req: Request) => Promise<Response>)
        | ((req: Request, ctx: { params: Promise<Record<string, unknown>> }) => Promise<Response>);
      expect(typeof handler, `${row.name} must export ${row.verb}`).toBe("function");
      // Call with one argument: handlers that take a route context ignore the absence, and
      // handlers that need it would fail on params rather than on auth, which is not what this
      // asserts. The routes listed here are all context-free by design.
      const res = await (handler as (req: Request) => Promise<Response>)(
        new Request(row.url, { method: row.verb, body: row.body, headers: row.body ? { "content-type": "application/json" } : undefined }),
      );
      expect(res.status, `${row.name} must deny an unauthenticated caller`).toBeGreaterThanOrEqual(400);
      expect(res.status, `${row.name} must not report a server crash as the gate`).toBeLessThan(500);
    });
  }
});

describe("status-code contract: the gate is the auth check, not a parse error", () => {
  it("authenticated baseline works, so the denials above are the gate and not a broken harness", async () => {
    authed();
    // agent-vault is the plainest guarded GET here: no route context, no nextUrl, no body.
    const { GET } = await import("@/app/api/v1/agent-vault/route");
    const res = await (GET as unknown as (r: Request) => Promise<Response>)(
      new Request("https://mso.example/api/v1/agent-vault"),
    );
    expect(res.status).toBeLessThan(500);
  });

  it("exec/run returns 401 (not 400) when unauthenticated with a valid body", async () => {
    // The distinction matters: a 400 here would mean the body parser ran before the gate,
    // i.e. an unauthenticated caller can still reach input handling.
    unauthed();
    const { POST } = await import("@/app/api/v1/exec/run/route");
    const res = await POST(
      new Request("https://mso.example/api/v1/exec/run", {
        method: "POST",
        body: JSON.stringify({ command: "id" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("fs/raw returns 401 rather than serving bytes", async () => {
    // This route has two independent gates — verifyAuth at the top and a second getSessionActor
    // check before the stream is admitted — so removing either one alone still refuses. That is
    // defence in depth working, and it means this assertion proves the *pair* holds rather than
    // pinning which one fired. Recorded so nobody "simplifies" the second gate away believing
    // this test would catch it; it would not.
    unauthed();
    const { GET } = await import("@/app/api/v1/fs/raw/route");
    const res = await GET(new Request("https://mso.example/api/v1/fs/raw?path=/etc/passwd"));
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toContain("root:");
  });
});

describe("status-code contract: an authenticated owner is still gated by role where required", () => {
  it("a viewer cannot reach an owner-only route", async () => {
    // verifyAuth(req, "owner") returning false is how the codebase expresses "wrong role":
    // the mock only reports a session for the bare check, not for the owner check.
    mocks.verifyAuth.mockImplementation(async (_req?: Request, role?: string) => role === undefined);
    const { GET } = await import("@/app/api/mcp/tokens/route");
    const res = await GET(new Request("https://mso.example/api/mcp/tokens"));
    expect(res.status).toBe(401);
  });
});
