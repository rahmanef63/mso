// SERVER-ONLY. Keeps the self-hosted Nakama admin password equal to MSO's login
// password (#296). MSO's login stays authoritative and independent: `.env.local` is
// written first, this module only follows it, and a failure is reported rather than
// raised. There is no permanent second credential store: a rotation that could not
// reach Nakama leaves one private retry record holding the OLD password Nakama has,
// deleted as soon as a reconcile succeeds.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { audit } from "@/lib/host/audit-api";
import { request } from "@/lib/infra/http";
import { pinSecurityStorePath } from "@/lib/security-store-path";

const TIMEOUT_MS = 8_000;
const MAX_PENDING_BYTES = 4 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Why a change did not land. A status code or a network reason, never a body. */
class NakamaSyncError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NakamaSyncError";
  }
}

export type NakamaFollowResult =
  | "not_configured"
  /** The admin password was changed to MSO's current one. */
  | "synced"
  /** Nakama already accepted MSO's password; no change call was made. */
  | "already_matching"
  /** Failed, and a retry record was kept for the next boot. */
  | "queued"
  /** Failed with no way to retry automatically; an operator must act. */
  | "drift";

type NakamaConfig = { base: string; email: string };

export function nakamaConfig(env: NodeJS.ProcessEnv = process.env): NakamaConfig | null {
  const base = (env.NAKAMA_BASE_URL ?? "").trim();
  const email = (env.NAKAMA_ADMIN_EMAIL ?? "").trim();
  if (!base || !email) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new NakamaSyncError("invalid_base_url");
  }
  const loopback = LOOPBACK.has(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new NakamaSyncError("insecure_base_url");
  if (url.username || url.password || url.hash || url.search || url.pathname !== "/") throw new NakamaSyncError("invalid_base_url");
  return { base: url.origin, email };
}

// One private file, 0600, inside an owner-only pinned directory. It carries the
// previous password only so a retry can authenticate; it is never served or logged.
const pendingStore = () =>
  (process.env.OS_NAKAMA_PENDING_STORE ?? "").trim() || path.join(os.homedir(), ".mso", "private", "nakama-password-pending.json");

async function readPending(): Promise<string | null> {
  const pinned = await pinSecurityStorePath(pendingStore());
  // One descriptor for both the safety checks and the read: lstat-then-read on a
  // path is a time-of-check/time-of-use gap (CodeQL js/file-system-race), and a
  // swapped file could be read after passing the 0600 check.
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(pinned.file, "r");
    const stat = await handle.stat(), uid = process.getuid?.();
    if (!stat.isFile() || !stat.size || stat.size > MAX_PENDING_BYTES || (stat.mode & 0o077) || (uid !== undefined && stat.uid !== uid)) {
      throw new NakamaSyncError("unsafe_retry_store");
    }
    const parsed = JSON.parse(await handle.readFile("utf8")) as { previous?: unknown };
    return typeof parsed.previous === "string" && parsed.previous ? parsed.previous : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
    await pinned.directory.close().catch(() => undefined);
  }
}

/** Write the retry record, or delete it when `previous` is null. */
async function writePending(previous: string | null): Promise<void> {
  const pinned = await pinSecurityStorePath(pendingStore());
  const remove = (error: NodeJS.ErrnoException) => {
    if (previous || error.code !== "ENOENT") throw error;
  };
  try {
    if (!previous) { await fs.unlink(pinned.file).catch(remove); return; }
    const temporary = `${pinned.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ previous }), { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, pinned.file);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  } finally {
    await pinned.directory.close().catch(() => undefined);
  }
}

function sessionCookies(headers: Headers | undefined): { cookie: string; csrf: string } {
  const raw = headers && typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const pairs = new Map<string, string>();
  for (const entry of raw) {
    const pair = entry.split(";")[0] ?? "";
    const name = pair.slice(0, pair.indexOf("="));
    if (name) pairs.set(name.replace(/^__Host-/, ""), pair);
  }
  const session = pairs.get("nakama_session");
  const csrf = pairs.get("nakama_csrf");
  if (!session || !csrf) throw new NakamaSyncError("login_missing_session");
  return { cookie: `${session}; ${csrf}`, csrf: csrf.slice(csrf.indexOf("=") + 1) };
}

async function signIn(config: NakamaConfig, password: string, fetchImpl?: FetchLike) {
  const response = await request(`${config.base}/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: config.email, password }),
  }, TIMEOUT_MS, fetchImpl);
  if (!response.ok) throw new NakamaSyncError(`login_http_${response.status}`);
  return sessionCookies(response.headers);
}

async function changePassword(config: NakamaConfig, session: { cookie: string; csrf: string }, current: string, next: string, fetchImpl?: FetchLike): Promise<void> {
  const response = await request(
    `${config.base}/v1/auth/change-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session.cookie, "x-csrf-token": session.csrf },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    },
    TIMEOUT_MS,
    fetchImpl,
  );
  if (!response.ok) throw new NakamaSyncError(`change_http_${response.status}`);
}

// Only a category or status code reaches the trail: a provider body could echo submitted values.
function reasonOf(error: unknown): string {
  if (error instanceof NakamaSyncError) return error.reason;
  const message = (error as Error | undefined)?.message ?? "";
  if ((error as Error | undefined)?.name === "AbortError" || message.includes("timed out")) return "timeout";
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{2,32}$/.test(code) ? code : "unreachable";
}

/** Resolve config, reporting an unusable one instead of throwing at a caller. */
async function configOrReport(actor: string | null): Promise<NakamaConfig | null | "invalid"> {
  try {
    return nakamaConfig();
  } catch (error) {
    await audit({ action: "auth.nakama", actor, ok: false, detail: `config_invalid: ${reasonOf(error)}` });
    return "invalid";
  }
}

/** Rotation hook. Call after MSO's own write succeeded; this never throws. */
export async function followNakamaPassword(
  input: { current: string; next: string; actor?: string | null },
  deps: { fetchImpl?: FetchLike } = {},
): Promise<NakamaFollowResult> {
  const actor = input.actor ?? null;
  const config = await configOrReport(actor);
  if (config === "invalid") return "drift";
  if (!config) return "not_configured";
  try {
    await changePassword(config, await signIn(config, input.current, deps.fetchImpl), input.current, input.next, deps.fetchImpl);
    await writePending(null).catch(() => undefined);
    await audit({ action: "auth.nakama", actor, ok: true, target: config.base, detail: "password_synced" });
    return "synced";
  } catch (error) {
    // Keep the OLDEST queued password: Nakama still has the one from before the first
    // failed sync, so overwriting it with a later intermediate would break the replay.
    const queued = await readPending().catch(() => null);
    await writePending(queued ?? input.current).catch(() => undefined);
    await audit({ action: "auth.nakama", actor, ok: false, target: config.base, detail: `sync_failed: ${reasonOf(error)}` });
    return "queued";
  }
}

/** Boot safety net. Converges a rotation Nakama missed, or proves the pair matches. */
export async function reconcileNakamaPassword(deps: { fetchImpl?: FetchLike } = {}): Promise<NakamaFollowResult> {
  const config = await configOrReport(null);
  if (config === "invalid") return "drift";
  if (!config) return "not_configured";
  const current = process.env.OS_LOGIN_PASSWORD ?? "";
  if (current.length < 6) return "drift";
  const pending = await readPending().catch(() => null);
  // Probe the target password first: a change call whose response was lost may already
  // have applied, and that must converge instead of retrying an old password forever.
  try {
    await signIn(config, current, deps.fetchImpl);
    if (!pending || pending === current) {
      if (pending) await writePending(null);
      return "already_matching";
    }
    await writePending(null);
    await audit({ action: "auth.nakama", ok: true, target: config.base, detail: "reconciled_confirmed" });
    return "synced";
  } catch (error) {
    if (!pending || pending === current) {
      await audit({ action: "auth.nakama", ok: false, target: config.base, detail: `reconcile_failed: ${reasonOf(error)}` });
      return "drift";
    }
  }
  try {
    await changePassword(config, await signIn(config, pending, deps.fetchImpl), pending, current, deps.fetchImpl);
    await writePending(null);
    await audit({ action: "auth.nakama", ok: true, target: config.base, detail: "reconciled_retry" });
    return "synced";
  } catch (error) {
    await audit({ action: "auth.nakama", ok: false, target: config.base, detail: `reconcile_failed: ${reasonOf(error)}` });
    return "queued";
  }
}
