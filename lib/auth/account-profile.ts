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

function imageIcon(value: unknown): AccountIcon | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.type !== "image" || typeof row.src !== "string" || row.src.length > 48_000) return null;
  const match = DATA_URL.exec(row.src);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 16 || bytes.length > 32_000) return null;
  const kind = match[1];
  const gif = bytes.subarray(0, 6).toString("ascii");
  const ok = kind === "png" ? bytes.subarray(0, 8).equals(PNG)
    : kind === "jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : kind === "gif" ? gif === "GIF87a" || gif === "GIF89a"
    : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return ok ? { type: "image", src: row.src } : null;
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
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(profile), { encoding: "utf8", mode: 0o600 });
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
