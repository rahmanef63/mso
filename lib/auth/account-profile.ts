import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  cleanAccountName,
  DEFAULT_ACCOUNT_PROFILE,
  presetIcon,
  type AccountIcon,
  type AccountProfile,
} from "./account-profile-model";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

export class AccountProfileError extends Error {
  constructor(readonly code: "corrupt" | "invalid") {
    super(code);
    this.name = "AccountProfileError";
  }
}

function storePath(): string {
  return expandOwnerStorePath(process.env.OS_ACCOUNT_STORE ?? path.join(os.homedir(), ".mso", "account.json"));
}

function base64Digit(n: number): string {
  switch (n) {
    case 0: return "A"; case 1: return "B"; case 2: return "C"; case 3: return "D";
    case 4: return "E"; case 5: return "F"; case 6: return "G"; case 7: return "H";
    case 8: return "I"; case 9: return "J"; case 10: return "K"; case 11: return "L";
    case 12: return "M"; case 13: return "N"; case 14: return "O"; case 15: return "P";
    case 16: return "Q"; case 17: return "R"; case 18: return "S"; case 19: return "T";
    case 20: return "U"; case 21: return "V"; case 22: return "W"; case 23: return "X";
    case 24: return "Y"; case 25: return "Z"; case 26: return "a"; case 27: return "b";
    case 28: return "c"; case 29: return "d"; case 30: return "e"; case 31: return "f";
    case 32: return "g"; case 33: return "h"; case 34: return "i"; case 35: return "j";
    case 36: return "k"; case 37: return "l"; case 38: return "m"; case 39: return "n";
    case 40: return "o"; case 41: return "p"; case 42: return "q"; case 43: return "r";
    case 44: return "s"; case 45: return "t"; case 46: return "u"; case 47: return "v";
    case 48: return "w"; case 49: return "x"; case 50: return "y"; case 51: return "z";
    case 52: return "0"; case 53: return "1"; case 54: return "2"; case 55: return "3";
    case 56: return "4"; case 57: return "5"; case 58: return "6"; case 59: return "7";
    case 60: return "8"; case 61: return "9"; case 62: return "+"; case 63: return "/";
    default: return "A";
  }
}

function encodeBase64(bytes: Buffer): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] ?? 0 : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] ?? 0 : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += base64Digit((n >>> 18) & 63);
    out += base64Digit((n >>> 12) & 63);
    out += i + 1 < bytes.length ? base64Digit((n >>> 6) & 63) : "=";
    out += i + 2 < bytes.length ? base64Digit(n & 63) : "=";
  }
  return out;
}

function imagePrefix(kind: string): string | null {
  switch (kind) {
    case "png": return "data:image/png;base64,";
    case "jpeg": return "data:image/jpeg;base64,";
    case "webp": return "data:image/webp;base64,";
    case "gif": return "data:image/gif;base64,";
    default: return null;
  }
}

function imageMagic(kind: string, bytes: Buffer): boolean {
  const gif = bytes.subarray(0, 6).toString("ascii");
  if (kind === "png") return bytes.subarray(0, 8).equals(PNG);
  if (kind === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (kind === "gif") return gif === "GIF87a" || gif === "GIF89a";
  return kind === "webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function imageIcon(value: unknown): AccountIcon | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "image" || typeof row.src !== "string" || row.src.length > 48_000) return null;
  const match = DATA_URL.exec(row.src);
  if (!match?.[1] || !match[2]) return null;
  const prefix = imagePrefix(match[1]);
  const decoded = Buffer.from(match[2], "base64");
  if (!prefix || decoded.length < 16 || decoded.length > 32_000 || !imageMagic(match[1], decoded)) return null;
  const bytes = Buffer.alloc(decoded.length);
  decoded.copy(bytes);
  if (!imageMagic(match[1], bytes)) return null;
  return { type: "image", src: prefix + encodeBase64(bytes) };
}

export function cleanAccountIcon(value: unknown): AccountIcon | null {
  return presetIcon(value) ?? imageIcon(value);
}

function parseProfile(raw: string): AccountProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AccountProfileError("corrupt");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AccountProfileError("corrupt");
  const row = parsed as Record<string, unknown>;
  const name = cleanAccountName(row.name);
  const icon = cleanAccountIcon(row.icon);
  if (!name || !icon) throw new AccountProfileError("corrupt");
  return { name, icon };
}

export async function readAccountProfile(): Promise<AccountProfile> {
  try {
    return parseProfile(await fs.readFile(storePath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_ACCOUNT_PROFILE };
    if (error instanceof AccountProfileError) throw error;
    throw new AccountProfileError("corrupt");
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

async function persist(profile: AccountProfile): Promise<void> {
  const name = cleanAccountName(profile.name);
  const icon = cleanAccountIcon(profile.icon);
  if (!name || !icon) throw new AccountProfileError("invalid");
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ name, icon }), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function writeAccountProfile(patch: { name?: unknown; icon?: unknown }): Promise<AccountProfile> {
  const run = writeChain.then(async () => {
    const current = await readAccountProfile();
    const name = patch.name === undefined ? current.name : cleanAccountName(patch.name);
    const icon = patch.icon === undefined ? current.icon : cleanAccountIcon(patch.icon);
    if (!name || !icon) throw new AccountProfileError("invalid");
    const next: AccountProfile = { name, icon };
    await persist(next);
    return next;
  });
  writeChain = run.catch(() => undefined);
  return run;
}
