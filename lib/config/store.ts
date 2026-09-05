import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { envCredentialStore, PROVIDERS } from "@/lib/models";
import { DEFAULT_PROVIDER, defaultModelFor } from "@/lib/models/defaults";

export interface CustomProviderConn {
  baseUrl: string;
  protocol?: "openai" | "anthropic";
  models?: string[];
}

export interface OAuthBundle {
  kind: "oauth";
  access: string;
  refresh?: string;
  expires: number;
  accountId?: string;
  ghToken?: string;
  copilotToken?: string;
}

export interface OsConfig {
  keys?: Record<string, string>;
  provider?: string;
  model?: string;
  customProviders?: Record<string, CustomProviderConn>;
  oauthTokens?: Record<string, OAuthBundle>;
  tokenSaver?: "off" | "caveman" | "ponytail";
  /** @deprecated back-compat read alias for keys.anthropic. */
  anthropicApiKey?: string;
}

const CONFIG_PATH = expandOwnerStorePath(process.env.OS_CONFIG_STORE ?? path.join(os.homedir(), ".mso", "config.json"));
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const DEFAULT_MODEL = defaultModelFor(DEFAULT_PROVIDER);
export { DEFAULT_PROVIDER };

function safeProviderId(value: string): string {
  if (!PROVIDER_ID_RE.test(value) || RESERVED_RECORD_KEYS.has(value)) throw new Error("invalid provider id");
  return value;
}

function recordValue<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return Object.entries(record ?? {}).find(([name]) => name === key)?.[1];
}

function recordSet<T>(record: Record<string, T> | undefined, key: string, value: T): Record<string, T> {
  return Object.fromEntries([
    ...Object.entries(record ?? {}).filter(([name]) => name !== key),
    [key, value],
  ]);
}

function recordDelete<T>(record: Record<string, T> | undefined, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record ?? {}).filter(([name]) => name !== key));
}

export async function readConfig(): Promise<OsConfig> {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")) as OsConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(patch: OsConfig): Promise<void> {
  const current = await readConfig();
  const next: OsConfig = { ...current, ...patch };
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, CONFIG_PATH);
}

export async function resolveModelRef(): Promise<string> {
  const c = await readConfig();
  const provider = safeProviderId(c.provider || DEFAULT_PROVIDER);
  return `${provider}/${c.model || defaultModelFor(provider)}`;
}

export function hostCredentialStore() {
  const env = envCredentialStore();
  return {
    async getKey(_tenant: string | undefined, provider: string) {
      const safe = safeProviderId(provider);
      const c = await readConfig();
      const fromFile = recordValue(c.keys, safe) ?? (safe === "anthropic" ? c.anthropicApiKey : undefined);
      return fromFile || (await env.getKey(_tenant, safe));
    },
    async setKey(_tenant: string | undefined, provider: string, key: string) {
      const safe = safeProviderId(provider);
      const c = await readConfig();
      await writeConfig({ keys: recordSet(c.keys, safe, key) });
    },
    async deleteKey(_tenant: string | undefined, provider: string) {
      const safe = safeProviderId(provider);
      const c = await readConfig();
      await writeConfig({ keys: recordDelete(c.keys, safe) });
    },
  };
}

export function slugifyProvider(name: string): string {
  let slug = "";
  let pendingDash = false;
  for (const ch of name.trim().toLowerCase()) {
    const alnum = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
    if (alnum) {
      if (pendingDash && slug) slug += "-";
      slug += ch;
      pendingDash = false;
    } else pendingDash = true;
    if (slug.length >= 40) break;
  }
  return slug ? safeProviderId(slug) : "";
}

export function isBuiltinProvider(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, slug);
}

export async function selectedCustomConn(): Promise<CustomProviderConn | null> {
  const c = await readConfig();
  const provider = safeProviderId(c.provider || DEFAULT_PROVIDER);
  return recordValue(c.customProviders, provider) ?? null;
}

export async function upsertCustomProvider(slug: string, conn: CustomProviderConn): Promise<void> {
  const safe = safeProviderId(slug);
  const c = await readConfig();
  await writeConfig({ customProviders: recordSet(c.customProviders, safe, conn) });
}

export async function removeCustomProvider(slug: string): Promise<void> {
  const safe = safeProviderId(slug);
  const c = await readConfig();
  await writeConfig({ customProviders: recordDelete(c.customProviders, safe) });
}

export async function readOAuthBundle(slug: string): Promise<OAuthBundle | null> {
  const safe = safeProviderId(slug);
  const c = await readConfig();
  return recordValue(c.oauthTokens, safe) ?? null;
}

export async function writeOAuthBundle(slug: string, bundle: OAuthBundle): Promise<void> {
  const safe = safeProviderId(slug);
  const c = await readConfig();
  await writeConfig({ oauthTokens: recordSet(c.oauthTokens, safe, bundle) });
}

export async function removeOAuthBundle(slug: string): Promise<void> {
  const safe = safeProviderId(slug);
  const c = await readConfig();
  await writeConfig({ oauthTokens: recordDelete(c.oauthTokens, safe) });
}
