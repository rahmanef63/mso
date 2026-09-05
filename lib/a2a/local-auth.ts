import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import {
  readA2APrivateStore,
  writeA2APrivateStore,
} from "./credential-private-store";
import {
  a2aLoopbackEnabled,
  a2aLoopbackOrigin,
  isA2ALoopbackUrl,
} from "./network";

const STORE =
  expandOwnerStorePath(process.env.OS_A2A_LOCAL_AUTH_STORE ??
  path.join(os.homedir(), ".mso", "private", "a2a-local-auth.json"));

type LocalAuthStore = { version: 1; bearer: string; createdAt: string };
const isStore = (value: unknown): value is LocalAuthStore =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as LocalAuthStore).version === 1 &&
    typeof (value as LocalAuthStore).bearer === "string" &&
    (value as LocalAuthStore).bearer.startsWith("mso_local_a2a_") &&
    typeof (value as LocalAuthStore).createdAt === "string",
  );
const empty = { version: 1, bearer: "", createdAt: "" } as LocalAuthStore;

async function readLocal(): Promise<LocalAuthStore | null> {
  const value = await readA2APrivateStore(
    STORE,
    empty,
    (candidate): candidate is LocalAuthStore => {
      if (candidate === empty) return true;
      return isStore(candidate);
    },
  );
  return value.bearer ? value : null;
}

export async function getOrCreateA2ALocalBearer(): Promise<string> {
  if (!a2aLoopbackEnabled()) throw new Error("A2A loopback mode is disabled");
  const existing = await readLocal();
  if (existing) return existing.bearer;
  return withSecurityStoreLock(STORE, async () => {
    const current = await readLocal();
    if (current) return current.bearer;
    const record: LocalAuthStore = {
      version: 1,
      bearer: `mso_local_a2a_${randomBytes(32).toString("base64url")}`,
      createdAt: new Date().toISOString(),
    };
    await writeA2APrivateStore(STORE, record);
    return record.bearer;
  });
}

export function isOwnA2ALoopbackUrl(value: string | URL): boolean {
  if (!a2aLoopbackEnabled() || !isA2ALoopbackUrl(value)) return false;
  try {
    const target = value instanceof URL ? value : new URL(String(value));
    const own = new URL(a2aLoopbackOrigin());
    const targetPort = target.port || "80";
    const ownPort = own.port || "80";
    return targetPort === ownPort;
  } catch {
    return false;
  }
}

export async function authenticateA2ALocalBearer(
  raw: string,
  requestUrl: string,
): Promise<boolean> {
  if (!isOwnA2ALoopbackUrl(requestUrl)) return false;
  const candidate = Buffer.from(String(raw || ""));
  const expected = Buffer.from(await getOrCreateA2ALocalBearer());
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}
