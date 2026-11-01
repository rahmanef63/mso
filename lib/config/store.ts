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

const OWNER_CONFIG_PATH = expandOwnerStorePath(process.env.OS_CONFIG_STORE ?? path.join(os.homedir(), ".mso", "config.json"));
const MULTIUSER_ROOT = expandOwnerStorePath(process.env.OS_MULTIUSER_ROOT ?? path.join(os.homedir(), ".mso", "users"));
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TENANT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function safeTenantId(value: string): string {
  if (!TENANT_ID_RE.test(value) || RESERVED_RECORD_KEYS.has(value)) throw new Error("invalid tenant id");
  return value;
}

// owner (undefined) keeps the legacy single-file store — no migration. A named
// tenant resolves to <root>/<id>/config.json, contained under the multiuser root.
function configPath(tenant?: string): string {
  if (tenant === undefined) return OWNER_CONFIG_PATH;
  const id = safeTenantId(tenant);
  const resolved = path.resolve(MULTIUSER_ROOT, id, "config.json");
  const rel = path.relative(path.resolve(MULTIUSER_ROOT), resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("invalid tenant id");
  return resolved;
}

export const DEFAULT_MODEL = defaultModelFor(DEFAULT_PROVIDER);
export { DEFAULT_PROVIDER };

export function safeProviderId(value: string): string {
  if (!PROVIDER_ID_RE.test(value) || RESERVED_RECORD_KEYS.has(value)) throw new Error("invalid provider id");
  return value;
}

// A model id is not free text: it is spliced into a provider request body and, on some
// providers, into a path. Nothing validated the model half of a `provider/model` ref — only the
// provider was checked — so a config value could carry anything into an outbound request.
// Deliberately permissive about the shapes real catalogues use (OpenRouter's `vendor/model`,
// `:free` suffixes, dots and underscores) and strict about everything else.
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,199}$/;

export function safeModelId(value: string): string {
  if (!MODEL_ID_RE.test(value) || RESERVED_RECORD_KEYS.has(value) || value.includes("..")) {
    throw new Error("invalid model id");
  }
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

export async function readConfig(tenant?: string): Promise<OsConfig> {
  try {
    return JSON.parse(await fs.readFile(/* turbopackIgnore: true */ configPath(tenant), "utf8")) as OsConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(patch: OsConfig, tenant?: string): Promise<void> {
  const target = configPath(tenant);
  const current = await readConfig(tenant);
  const next: OsConfig = { ...current, ...patch };
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}

export async function resolveModelRef(tenant?: string): Promise<string> {
  const c = await readConfig(tenant);
  const provider = safeProviderId(c.provider || DEFAULT_PROVIDER);
  // Validated here as well as at the parse boundary, because this is the path a stored config
  // takes into an outbound request. Throwing on a bad value is correct: the caller turns it into
  // a 400, and a model id that cannot be sent is not a model id.
  const model = safeModelId(c.model || defaultModelFor(provider));
  return `${provider}/${model}`;
}

export function hostCredentialStore() {
  const env = envCredentialStore();
  return {
    async getKey(tenant: string | undefined, provider: string) {
      const safe = safeProviderId(provider);
      const c = await readConfig(tenant);
      const fromFile = recordValue(c.keys, safe) ?? (safe === "anthropic" ? c.anthropicApiKey : undefined);
      if (fromFile) return fromFile;
      // Owner may fall back to process env (dev/single-tenant). A named tenant must
      // not inherit the host's env keys — it resolves only from its own file.
      return tenant === undefined ? env.getKey(tenant, safe) : null;
    },
    async setKey(tenant: string | undefined, provider: string, key: string) {
      const safe = safeProviderId(provider);
      const c = await readConfig(tenant);
      await writeConfig({ keys: recordSet(c.keys, safe, key) }, tenant);
    },
    async deleteKey(tenant: string | undefined, provider: string) {
      const safe = safeProviderId(provider);
      const c = await readConfig(tenant);
      await writeConfig({ keys: recordDelete(c.keys, safe) }, tenant);
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

export async function selectedCustomConn(tenant?: string): Promise<CustomProviderConn | null> {
  const c = await readConfig(tenant);
  const provider = safeProviderId(c.provider || DEFAULT_PROVIDER);
  return recordValue(c.customProviders, provider) ?? null;
}

export async function upsertCustomProvider(slug: string, conn: CustomProviderConn, tenant?: string): Promise<void> {
  const safe = safeProviderId(slug);
  const c = await readConfig(tenant);
  await writeConfig({ customProviders: recordSet(c.customProviders, safe, conn) }, tenant);
}

export async function removeCustomProvider(slug: string, tenant?: string): Promise<void> {
  const safe = safeProviderId(slug);
  const c = await readConfig(tenant);
  await writeConfig({ customProviders: recordDelete(c.customProviders, safe) }, tenant);
}

export async function readOAuthBundle(slug: string, tenant?: string): Promise<OAuthBundle | null> {
  const safe = safeProviderId(slug);
  const c = await readConfig(tenant);
  return recordValue(c.oauthTokens, safe) ?? null;
}

export async function writeOAuthBundle(slug: string, bundle: OAuthBundle, tenant?: string): Promise<void> {
  const safe = safeProviderId(slug);
  const c = await readConfig(tenant);
  await writeConfig({ oauthTokens: recordSet(c.oauthTokens, safe, bundle) }, tenant);
}

export async function removeOAuthBundle(slug: string, tenant?: string): Promise<void> {
  const safe = safeProviderId(slug);
  const c = await readConfig(tenant);
  await writeConfig({ oauthTokens: recordDelete(c.oauthTokens, safe) }, tenant);
}
