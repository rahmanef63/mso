import { constants as fsConstants, promises as fs } from "fs";
import path from "path";
import { constantTimeEq, MAX_COMPARE_BYTES } from "./session";

// Rotates the existing login secret. There is no password hash and no second
// credential store: login still compares OS_LOGIN_PASSWORD in constant time,
// and the durable copy remains the service EnvironmentFile (.env.local).

const WINDOW_MS = 60_000;
const MAX_FAILURES = 5;
const SAFE_PASSWORD = /^[A-Za-z0-9!@%^*_+\-=.,:?~]{6,128}$/;
const failures = new Map<string, { count: number; resetAt: number }>();

export type LoginPasswordCode =
  | "not_configured"
  | "bad_current"
  | "mismatch"
  | "weak_password"
  | "unchanged"
  | "password_source_mismatch"
  | "password_file_unsafe"
  | "rate_limited";

export class LoginPasswordError extends Error {
  constructor(readonly code: LoginPasswordCode) {
    super(code);
    this.name = "LoginPasswordError";
  }
}

export function resetLoginPasswordAttempts(): void {
  failures.clear();
}

export function loginPasswordPath(): string {
  return path.join(process.cwd(), ".env.local");
}

function bounded(value: string): boolean {
  return value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_COMPARE_BYTES;
}

export function passwordPolicyError(value: string): "weak_password" | null {
  if (!bounded(value) || !SAFE_PASSWORD.test(value)) return "weak_password";
  return null;
}

function limited(actor: string): boolean {
  const now = Date.now();
  const entry = failures.get(actor);
  return Boolean(entry && now <= entry.resetAt && entry.count >= MAX_FAILURES);
}

function noteFailure(actor: string): void {
  const now = Date.now();
  const entry = failures.get(actor);
  if (!entry || now > entry.resetAt) failures.set(actor, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

export function extractLoginPassword(text: string): string {
  const hits = text.split(/\n/).map((line) => line.replace(/\r$/, "")).filter((line) => line.startsWith("OS_LOGIN_PASSWORD="));
  if (hits.length !== 1) throw new LoginPasswordError("password_source_mismatch");
  let value = hits[0].slice("OS_LOGIN_PASSWORD=".length);
  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
    value = value.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  if (!bounded(value)) throw new LoginPasswordError("password_source_mismatch");
  return value;
}

export function replaceLoginPassword(text: string, next: string): string {
  if (passwordPolicyError(next)) throw new LoginPasswordError("weak_password");
  let seen = 0;
  const lines = text.split(/\n/).map((line) => {
    const bare = line.replace(/\r$/, "");
    if (!bare.startsWith("OS_LOGIN_PASSWORD=")) return line;
    seen += 1;
    return line.endsWith("\r") ? `OS_LOGIN_PASSWORD=${next}\r` : `OS_LOGIN_PASSWORD=${next}`;
  });
  if (seen !== 1) throw new LoginPasswordError("password_source_mismatch");
  return lines.join("\n");
}

async function readEnvFile(file: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    const uid = process.getuid?.();
    if (!stat.isFile() || stat.size > 256 * 1024 || (stat.mode & 0o077) || (uid !== undefined && stat.uid !== uid)) {
      throw new LoginPasswordError("password_file_unsafe");
    }
    return await handle.readFile("utf8");
  } catch (error) {
    if (error instanceof LoginPasswordError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new LoginPasswordError("password_source_mismatch");
    throw new LoginPasswordError("password_file_unsafe");
  } finally {
    await handle?.close();
  }
}

async function writeEnvFile(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(text, "utf8");
    await handle.close();
    handle = null;
    await fs.rename(tmp, file);
  } catch (error) {
    if (handle) await handle.close();
    await fs.unlink(tmp).catch(() => undefined);
    if (error instanceof LoginPasswordError) throw error;
    throw new LoginPasswordError("password_file_unsafe");
  }
}

export async function rotateLoginPassword(input: {
  current: string;
  next: string;
  confirm: string;
  actor: string;
  file?: string;
}): Promise<void> {
  const actor = input.actor || "owner";
  if (limited(actor)) throw new LoginPasswordError("rate_limited");
  if (passwordPolicyError(input.next)) throw new LoginPasswordError("weak_password");
  if (!bounded(input.confirm) || !constantTimeEq(input.next, input.confirm)) throw new LoginPasswordError("mismatch");
  const configured = process.env.OS_LOGIN_PASSWORD ?? "";
  if (configured.length < 6 || !bounded(configured)) throw new LoginPasswordError("not_configured");
  if (!bounded(input.current) || !constantTimeEq(configured, input.current)) {
    noteFailure(actor);
    throw new LoginPasswordError("bad_current");
  }
  if (constantTimeEq(configured, input.next)) throw new LoginPasswordError("unchanged");
  const file = input.file ?? loginPasswordPath();
  const text = await readEnvFile(file);
  const stored = extractLoginPassword(text);
  if (!constantTimeEq(stored, configured)) throw new LoginPasswordError("password_source_mismatch");
  await writeEnvFile(file, replaceLoginPassword(text, input.next));
  process.env.OS_LOGIN_PASSWORD = input.next;
  failures.delete(actor);
}
