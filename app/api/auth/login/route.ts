import { NextRequest, NextResponse } from "next/server";
import { constantTimeEq, MAX_COMPARE_BYTES, MIN_SECRET_LEN, signSession, type SessionPayload } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/require-session";
import { sessionCookieAttrs } from "@/lib/auth/session-cookie";
import { isApproved, isValidDeviceId, recordPending, touchApproved } from "@/lib/auth/device-store";
import { audit } from "@/lib/host/audit-api";
import { IS_DEMO } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Password + device-approval login, implemented for the VPS control plane.
//   gate 1 = shared password (OS_LOGIN_PASSWORD)
//   gate 2 = device id pre-approved in the device store
// Correct password on an un-approved device → recorded pending, 403, NO cookie.

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 1024;
const GLOBAL_MAX_ATTEMPTS = 30;

const rateLimitMap = new Map<string, { count: number; reset_at: number }>();
let globalWindowStart = Date.now();
let globalAttempts = 0;

// Exported for tests — module-private otherwise.
export function clientIp(req: NextRequest): string {
  // x-forwarded-for is a comma-separated trail; the leftmost entries are
  // client-supplied and spoofable. The first hop WE trust is N from the end,
  // where N = number of reverse proxies in front of this app (Cloudflare →
  // nginx → app = 2). Default 1 = direct proxy. Direct access with a forged
  // header still spoofs this, so :4005 must stay firewalled behind the proxy;
  // the global limiter caps brute force anyway.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length > 0) {
      const parsed = Number(process.env.OS_TRUSTED_PROXY_HOPS ?? "1");
      const trustedN = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
      // trustedN=1 → last hop (current behavior). trustedN=2 → second from last.
      // Clamp to the start of the list if N exceeds the chain length.
      const idx = Math.max(0, hops.length - trustedN);
      const hop = hops[idx];
      if (hop) return hop;
    }
  }
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}

// ORDER MATTERS, and getting it wrong was an unauthenticated lockout of the owner.
// The global counter used to increment FIRST and unconditionally — including for
// requests the per-IP limiter was already rejecting. So one IP, past its 5/min, kept
// burning the process-wide 30/min budget, and every OTHER caller — the owner, from a
// different address, with the correct password — got 429 for as long as the flood
// continued. No credential required, from the public internet, indefinitely.
//
// Now the per-IP gate runs first and an already-blocked IP returns without touching
// the global budget, so the process-wide cap only ever counts attempts that were
// actually going to reach the password compare.
//
// That reorder killed the single-IP variant but not the distributed one: six fresh
// IPs spending 5 attempts each still filled the 30/min process-wide budget here, and
// the owner's CORRECT password from a seventh address then got 429. So the global
// budget is no longer charged on the way in at all — it is charged below, only by an
// attempt that actually failed the password compare. A correct password can never be
// rejected by it, while the distributed brute-force cap is unchanged (30 wrong
// passwords per minute process-wide, on top of the per-IP 5/min).
function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (now - globalWindowStart > WINDOW_MS) {
    globalWindowStart = now;
    globalAttempts = 0;
  }

  if (rateLimitMap.size > MAX_TRACKED_IPS) {
    for (const [k, v] of rateLimitMap) if (now > v.reset_at) rateLimitMap.delete(k);
    if (rateLimitMap.size > MAX_TRACKED_IPS) rateLimitMap.clear();
  }
  const entry = rateLimitMap.get(ip);
  const live = entry && now <= entry.reset_at;
  if (live && entry.count >= MAX_ATTEMPTS) return true;

  if (!live) {
    rateLimitMap.set(ip, { count: 1, reset_at: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return false;
}

export async function POST(req: NextRequest) {
  if (IS_DEMO) {
    return NextResponse.json({ error: "login_disabled_in_demo" }, { status: 403 });
  }

  const sessionSecret = process.env.OS_SESSION_SECRET ?? "";
  const password = process.env.OS_LOGIN_PASSWORD ?? "";
  // Signing key must be strong and the configured login secret must fit the
  // fixed-width comparator. Fail closed on an unusable server configuration.
  if (
    sessionSecret.length < MIN_SECRET_LEN ||
    password.length < 6 ||
    Buffer.byteLength(password, "utf8") > MAX_COMPARE_BYTES
  ) {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    audit({ action: "auth.ratelimited", ip, ok: false });
    return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }

  let body: { password?: string; deviceId?: string; deviceLabel?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { password: provided, deviceId } = body;
  if (
    typeof provided !== "string" ||
    provided.length === 0 ||
    Buffer.byteLength(provided, "utf8") > MAX_COMPARE_BYTES
  ) {
    return NextResponse.json({ error: "bad_password" }, { status: 401 });
  }
  if (!isValidDeviceId(deviceId)) {
    return NextResponse.json({ error: "Missing or invalid device id" }, { status: 400 });
  }
  const label = typeof body.deviceLabel === "string" ? body.deviceLabel.slice(0, 80) : "unknown device";

  // Length-safe fixed-width comparison; no reusable password hash is created.
  if (!constantTimeEq(password, provided)) {
    audit({ action: "auth.denied", actor: deviceId, ip, ok: false, detail: "bad password" });
    // Charge the process-wide budget HERE, not in rateLimited(), so only a genuinely
    // wrong password can exhaust it. See the note above rateLimited().
    if (++globalAttempts > GLOBAL_MAX_ATTEMPTS) {
      audit({ action: "auth.ratelimited", ip, ok: false, detail: "global" });
      return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
    }
    return NextResponse.json({ error: "bad_password" }, { status: 401 });
  }

  if (!(await isApproved(deviceId))) {
    await recordPending(deviceId, label, ip);
    audit({ action: "auth.pending", actor: deviceId, ip, ok: false, detail: label });
    return NextResponse.json({ error: "device_pending", deviceId, label }, { status: 403 });
  }
  await touchApproved(deviceId);
  audit({ action: "auth.login", actor: deviceId, ip, ok: true });

  // Guard the env parse: NaN here would mint a cookie that NEVER expires
  // (NaN <= Date.now() is false in verifySession) — fail back to 24h instead.
  const parsedHours = parseInt(process.env.SESSION_EXPIRY_HOURS ?? "24", 10);
  const hours = Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 24;
  const now = Date.now();
  const payload: SessionPayload = {
    issued_at: now,
    expires_at: now + hours * 3600 * 1000,
    device_id: deviceId,
  };
  const res = NextResponse.json({ success: true });
  // Attributes (incl. the optional Domain for the split-origin app hosts) come
  // from one helper shared with logout, so a cookie can't be set with a Domain
  // the clear path then misses.
  res.cookies.set(SESSION_COOKIE, signSession(payload, sessionSecret), sessionCookieAttrs(req, hours * 3600));
  return res;
}
