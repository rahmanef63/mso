export const PLUGIN_MANIFEST_SCHEMA = "urn:agent-plugin:manifest:v1" as const;
export const PLUGIN_MANIFEST_VERSION = 1 as const;

export type PluginSkillDescriptor = {
  id: string;
  path: string;
};

export type PluginMcpDescriptor =
  | { transport: "stdio"; entrypoint: string; catalog: string }
  | { transport: "https"; endpoint: string };

export type PluginManifest = {
  $schema?: typeof PLUGIN_MANIFEST_SCHEMA;
  schemaVersion: typeof PLUGIN_MANIFEST_VERSION;
  version: string;
  id: string;
  metadata: {
    name: string;
    description: string;
    homepage?: string;
  };
  skills?: PluginSkillDescriptor[];
  mcp?: PluginMcpDescriptor[];
};

export type ManifestValidation =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SENSITIVE_TOKENS = new Set([
  "secret",
  "token",
  "password",
  "credential",
  "authorization",
  "header",
  "env",
  "command",
  "shell",
  "argv",
  "script",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function sensitiveKey(key: string) {
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => SENSITIVE_TOKENS.has(token));
}

function scanSensitiveKeys(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (sensitiveKey(key)) return key;
    const nested = scanSensitiveKeys(child);
    if (nested) return nested;
  }
  return null;
}

function exactKeys(object: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(object).every((key) => allowed.includes(key));
}

function safeText(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);
}

function safeId(value: unknown) {
  return typeof value === "string" && ID.test(value);
}

function safeRelativePath(value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512 || CONTROL.test(value)) return false;
  if (!SAFE_RELATIVE_PATH.test(value) || value.startsWith("/") || value.includes("\\")) return false;
  return !value.split("/").some((segment) => segment === ".." || segment === ".");
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 || CONTROL.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function validatePluginManifest(value: unknown): ManifestValidation {
  if (!isRecord(value)) return { ok: false, error: "Manifest must be a JSON object." };
  const sensitive = scanSensitiveKeys(value);
  if (sensitive) return { ok: false, error: `Manifest contains a sensitive or executable field: ${sensitive}.` };
  if (!exactKeys(value, ["$schema", "schemaVersion", "version", "id", "metadata", "skills", "mcp"])) {
    return { ok: false, error: "Manifest has unsupported fields." };
  }
  if (value.$schema !== undefined && value.$schema !== PLUGIN_MANIFEST_SCHEMA) {
    return { ok: false, error: `Unsupported plugin schema. Expected ${PLUGIN_MANIFEST_SCHEMA}.` };
  }
  if (value.schemaVersion !== PLUGIN_MANIFEST_VERSION) {
    return { ok: false, error: `Unsupported manifest schema version. Expected ${PLUGIN_MANIFEST_VERSION}.` };
  }
  if (typeof value.version !== "string" || !SEMVER.test(value.version)) {
    return { ok: false, error: "Plugin version must be semantic versioning." };
  }
  if (!safeId(value.id)) return { ok: false, error: "Plugin id must be a portable lowercase identifier." };

  if (!isRecord(value.metadata) || !exactKeys(value.metadata, ["name", "description", "homepage"])) {
    return { ok: false, error: "Plugin metadata is invalid." };
  }
  if (!safeText(value.metadata.name, 120) || !safeText(value.metadata.description, 1000)) {
    return { ok: false, error: "Plugin name or description is invalid." };
  }
  if (value.metadata.homepage !== undefined && !safeHttpsUrl(value.metadata.homepage)) {
    return { ok: false, error: "Plugin homepage must be a plain HTTPS URL." };
  }

  const skills = value.skills ?? [];
  if (!Array.isArray(skills) || skills.length > 100) {
    return { ok: false, error: "Plugin skills must contain at most 100 declarations." };
  }
  for (const skill of skills) {
    if (!isRecord(skill) || !exactKeys(skill, ["id", "path"]) || !safeId(skill.id) || !safeRelativePath(skill.path)) {
      return { ok: false, error: "Plugin skill declarations must use a safe id and package-relative path." };
    }
    if (!(skill.path as string).endsWith("SKILL.md")) {
      return { ok: false, error: "Plugin skill paths must point to SKILL.md." };
    }
  }

  const mcp = value.mcp ?? [];
  if (!Array.isArray(mcp) || mcp.length > 20) {
    return { ok: false, error: "Plugin MCP declarations must contain at most 20 entries." };
  }
  for (const descriptor of mcp) {
    if (!isRecord(descriptor)) return { ok: false, error: "Plugin MCP descriptor is invalid." };
    if (descriptor.transport === "stdio") {
      if (
        !exactKeys(descriptor, ["transport", "entrypoint", "catalog"]) ||
        !safeRelativePath(descriptor.entrypoint) ||
        !safeRelativePath(descriptor.catalog)
      ) {
        return { ok: false, error: "stdio MCP descriptors require safe package-relative entrypoint and catalog paths." };
      }
      continue;
    }
    if (descriptor.transport === "https") {
      if (!exactKeys(descriptor, ["transport", "endpoint"]) || !safeHttpsUrl(descriptor.endpoint)) {
        return { ok: false, error: "HTTPS MCP descriptors require one plain HTTPS endpoint." };
      }
      continue;
    }
    return { ok: false, error: "MCP transport must be stdio or https." };
  }

  return { ok: true, manifest: value as PluginManifest };
}

export const BUILT_IN_PLUGINS: readonly PluginManifest[] = Object.freeze([
  {
    $schema: PLUGIN_MANIFEST_SCHEMA,
    schemaVersion: 1,
    version: "0.9.8",
    id: "si-coder",
    metadata: {
      name: "SI-Coder",
      description: "Portable Agent Skills and MCP tools for building and publishing web applications.",
      homepage: "https://github.com/rahmanef63/si-coder-agent",
    },
    skills: [{ id: "si-coder-skills", path: "skills/sc/SKILL.md" }],
    mcp: [{ transport: "stdio", entrypoint: "scripts/sc-mcp.js", catalog: "machine/functions.json" }],
  },
  {
    $schema: PLUGIN_MANIFEST_SCHEMA,
    schemaVersion: 1,
    version: "1.19.0",
    id: "batonly",
    metadata: {
      name: "Batonly",
      description: "Project delivery collaboration MCP with a portable operating skill.",
      homepage: "https://batonly.site",
    },
    skills: [{ id: "baton", path: "plugin/skills/baton/SKILL.md" }],
    mcp: [{ transport: "https", endpoint: "https://site.batonly.site/mcp" }],
  },
]);

export function createPluginRegistry(custom: unknown[] = []) {
  const seen = new Set(BUILT_IN_PLUGINS.map((plugin) => plugin.id));
  const accepted: PluginManifest[] = [];
  for (const value of custom) {
    const result = validatePluginManifest(value);
    if (!result.ok || seen.has(result.manifest.id)) continue;
    seen.add(result.manifest.id);
    accepted.push(result.manifest);
  }
  return [...BUILT_IN_PLUGINS, ...accepted];
}
