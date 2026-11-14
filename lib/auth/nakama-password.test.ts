import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followNakamaPassword, reconcileNakamaPassword } from "./nakama-password";
import { resetLoginPasswordAttempts, rotateLoginPassword } from "./login-password";

const CURRENT = "current-pass";
const NEXT = "next-pass-1";
const BASE = "https://nakama.example.com";
const EMAIL = "owner@example.com";

type Call = { url: string; method: string; body: Record<string, unknown>; headers: Headers };
let calls: Call[];
let dir: string;
let envFile: string;
let auditFile: string;
let pendingFile: string;
/** The password Nakama currently accepts. Only one value is ever valid at a time. */
let nakamaPassword: string;
let change: (body: Record<string, unknown>) => Response;

function sessionResponse(password: string): Response {
  if (password !== nakamaPassword) return new Response('{"error":"Invalid credentials"}', { status: 401 });
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", `__Host-nakama_session=session-${Math.random().toString(36).slice(2)}; Path=/; HttpOnly; Secure`);
  headers.append("set-cookie", `__Host-nakama_csrf=csrf-${Math.random().toString(36).slice(2)}; Path=/; Secure`);
  return new Response('{"email":"owner@example.com","isPlatformAdmin":true}', { status: 200, headers });
}

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  calls.push({ url, method: String(init?.method ?? "GET"), body, headers: new Headers(init?.headers) });
  if (url.endsWith("/v1/auth/login")) return sessionResponse(String(body.password));
  if (url.endsWith("/v1/auth/change-password")) return change(body);
  return new Response("not found", { status: 404 });
});

const rotate = () =>
  rotateLoginPassword({ current: CURRENT, next: NEXT, confirm: NEXT, actor: "device-1", file: envFile });

async function auditLines(): Promise<string> {
  return fs.readFile(auditFile, "utf8").catch(() => "");
}

beforeEach(async () => {
  calls = [];
  // mkdtemp gives a private parent; pinSecurityStorePath accepts it under VITEST.
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-nakama-pw-"));
  envFile = path.join(dir, ".env.local");
  auditFile = path.join(dir, "audit.log");
  pendingFile = path.join(dir, "nakama-password-pending.json");
  await fs.writeFile(envFile, `OS_SESSION_SECRET=fixture-session-secret-long-enough\nOS_LOGIN_PASSWORD=${CURRENT}\n`, { mode: 0o600 });
  vi.stubEnv("OS_LOGIN_PASSWORD", CURRENT);
  vi.stubEnv("OS_AUDIT_LOG", auditFile);
  vi.stubEnv("OS_NAKAMA_PENDING_STORE", pendingFile);
  vi.stubEnv("NAKAMA_BASE_URL", BASE);
  vi.stubEnv("NAKAMA_ADMIN_EMAIL", EMAIL);
  resetLoginPasswordAttempts();
  nakamaPassword = CURRENT;
  change = (body) => {
    if (body.currentPassword !== nakamaPassword) return new Response('{"error":"Current password is incorrect."}', { status: 401 });
    nakamaPassword = String(body.newPassword);
    return new Response('{"ok":true}', { status: 200 });
  };
  vi.stubGlobal("fetch", fetchStub);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetLoginPasswordAttempts();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Nakama follows the MSO login password", () => {
  it("makes exactly one sync call after a rotation, with the documented body shape", async () => {
    // The rotation resolves void: no return value can carry a Nakama credential back.
    expect(await rotate()).toBeUndefined();
    const posts = calls.filter((call) => call.method === "POST");
    expect(posts.map((call) => new URL(call.url).pathname)).toEqual(["/v1/auth/login", "/v1/auth/change-password"]);
    const [loginCall, changeCall] = posts;
    expect(Object.keys(loginCall!.body).sort()).toEqual(["email", "password"]);
    expect(loginCall!.body.email).toBe(EMAIL);
    expect(Object.keys(changeCall!.body).sort()).toEqual(["currentPassword", "newPassword"]);
    expect(changeCall!.headers.get("x-csrf-token")).toMatch(/^csrf-/);
    expect(changeCall!.headers.get("cookie")).toContain("nakama_session=");
    expect(await fs.readFile(envFile, "utf8")).toContain(`OS_LOGIN_PASSWORD=${NEXT}`);
    expect(process.env.OS_LOGIN_PASSWORD).toBe(NEXT);
    expect(await auditLines()).toContain('"detail":"password_synced"');
    expect(await fs.stat(pendingFile).catch(() => null)).toBeNull();
    expect(nakamaPassword).toBe(NEXT);
    // The success line names the outcome only; no password appears in the serialized trail.
    const trail = await auditLines();
    expect(trail).not.toContain(CURRENT);
    expect(trail).not.toContain(NEXT);
    expect(trail).not.toContain("session-");
    expect(trail).not.toContain("csrf-");
  });

  it("reports a Nakama 4xx and still completes the MSO rotation", async () => {
    change = () => new Response('{"error":"Password must be at least 8 characters."}', { status: 400 });
    await rotate();
    expect(await fs.readFile(envFile, "utf8")).toContain(`OS_LOGIN_PASSWORD=${NEXT}`);
    expect(process.env.OS_LOGIN_PASSWORD).toBe(NEXT);
    const trail = await auditLines();
    expect(trail).toContain('"action":"auth.nakama"');
    expect(trail).toContain('"ok":false');
    expect(trail).toContain("change_http_400");
    // The rejection body is not copied into the trail, and neither password is.
    expect(trail).not.toContain("at least 8 characters");
    expect(trail).not.toContain(CURRENT);
    expect(trail).not.toContain(NEXT);
    // The old password Nakama still has is retained privately for the boot reconcile.
    expect(JSON.parse(await fs.readFile(pendingFile, "utf8")).previous).toBe(CURRENT);
    expect((await fs.stat(pendingFile)).mode & 0o777).toBe(0o600);
  });

  it("survives an unreachable Nakama and queues the reconcile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
    }));
    expect(await followNakamaPassword({ current: CURRENT, next: NEXT, actor: "device-1" })).toBe("queued");
    expect(process.env.OS_LOGIN_PASSWORD).toBe(CURRENT);
    expect(await auditLines()).toContain("sync_failed: ECONNREFUSED");
    expect(JSON.parse(await fs.readFile(pendingFile, "utf8")).previous).toBe(CURRENT);
  });

  it("does nothing and reports nothing when Nakama is not configured", async () => {
    vi.stubEnv("NAKAMA_BASE_URL", "");
    await rotate();
    expect(calls).toHaveLength(0);
    expect(await auditLines()).toBe("");
  });

  it("keeps the oldest queued password across repeated failed rotations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); }));
    expect(await followNakamaPassword({ current: CURRENT, next: NEXT })).toBe("queued");
    expect(await followNakamaPassword({ current: NEXT, next: "later-pass-2" })).toBe("queued");
    // Nakama still has CURRENT; overwriting it with NEXT would break the replay.
    expect(JSON.parse(await fs.readFile(pendingFile, "utf8")).previous).toBe(CURRENT);
    const result = await followNakamaPassword({ current: "later-pass-2", next: "later-pass-3" });
    expect(JSON.stringify(result)).not.toContain(CURRENT);
    expect(await auditLines()).not.toContain(CURRENT);
  });

  it("converges without a change call when the passwords already match", async () => {
    expect(await reconcileNakamaPassword()).toBe("already_matching");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/auth/login"]);
    expect(await fs.stat(pendingFile).catch(() => null)).toBeNull();
  });

  it("clears a stale retry record when the target password already works", async () => {
    // The change applied but its response was lost, so the old password is still on record.
    await fs.writeFile(pendingFile, JSON.stringify({ previous: CURRENT }), { mode: 0o600 });
    nakamaPassword = NEXT;
    vi.stubEnv("OS_LOGIN_PASSWORD", NEXT);
    expect(await reconcileNakamaPassword()).toBe("synced");
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/auth/login"]);
    expect(await fs.stat(pendingFile).catch(() => null)).toBeNull();
    expect(await auditLines()).toContain("reconciled_confirmed");
  });

  it("replays the queued old password once, then clears the retry record", async () => {
    await fs.writeFile(pendingFile, JSON.stringify({ previous: CURRENT }), { mode: 0o600 });
    vi.stubEnv("OS_LOGIN_PASSWORD", NEXT);
    expect(await reconcileNakamaPassword()).toBe("synced");
    const changeCall = calls.find((call) => call.url.endsWith("/v1/auth/change-password"))!;
    expect(changeCall.body).toEqual({ currentPassword: CURRENT, newPassword: NEXT });
    expect(nakamaPassword).toBe(NEXT);
    expect(await fs.stat(pendingFile).catch(() => null)).toBeNull();
    expect(await auditLines()).toContain("reconciled_retry");
  });

  it("keeps the retry record when neither password works and reports the failure", async () => {
    await fs.writeFile(pendingFile, JSON.stringify({ previous: CURRENT }), { mode: 0o600 });
    nakamaPassword = "some-third-pass";
    vi.stubEnv("OS_LOGIN_PASSWORD", NEXT);
    expect(await reconcileNakamaPassword()).toBe("queued");
    expect(await auditLines()).toContain("reconcile_failed: login_http_401");
    // The retry record survives so an operator can still replay it after fixing Nakama.
    expect(JSON.parse(await fs.readFile(pendingFile, "utf8")).previous).toBe(CURRENT);
  });

  it("reports drift when the target password is rejected and nothing is queued", async () => {
    nakamaPassword = "some-third-pass";
    expect(await reconcileNakamaPassword()).toBe("drift");
    expect(await auditLines()).toContain("reconcile_failed: login_http_401");
  });

  it("refuses an insecure base URL instead of sending the password over plain HTTP", async () => {
    vi.stubEnv("NAKAMA_BASE_URL", "http://nakama.example.com");
    expect(await followNakamaPassword({ current: CURRENT, next: NEXT })).toBe("drift");
    expect(calls).toHaveLength(0);
    expect(await auditLines()).toContain("config_invalid: insecure_base_url");
  });
});
