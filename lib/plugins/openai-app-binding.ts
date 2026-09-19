export type OpenAiAppBinding = {
  id: string;
  required?: boolean;
  optional?: boolean;
  category?: string;
};

export type OpenAiAppManifest = {
  apps: Record<string, OpenAiAppBinding>;
};

// OpenAI treats the object key as a package-local server alias. Reference
// packages use both kebab-case and snake_case aliases, so keep the accepted
// set portable while rejecting whitespace, paths, and punctuation.
const APP_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// Canonical .app.json IDs only. A plugin URL may contain plugin_asdk_app_*,
// but OpenAI requires the referenced app ID to be stored without plugin_.
const OPENAI_APP_ID = /^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9][A-Za-z0-9_-]*$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isOpenAiAppBindingId(value: unknown): value is string {
  return typeof value === "string" && OPENAI_APP_ID.test(value);
}

export function validateOpenAiAppManifest(value: unknown):
  | { ok: true; manifest: OpenAiAppManifest }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value) || !record(value.apps)) return { ok: false, errors: ["must contain an apps object"] };
  for (const [name, binding] of Object.entries(value.apps)) {
    if (!APP_KEY.test(name)) errors.push(`app key must contain only letters, digits, _ or - and start with a letter/digit: ${name}`);
    if (!record(binding)) {
      errors.push(`${name} binding must be an object`);
      continue;
    }
    if (!isOpenAiAppBindingId(binding.id)) errors.push(`${name}.id must be an exact canonical OpenAI app/connector id`);
    if (binding.required !== undefined && typeof binding.required !== "boolean")
      errors.push(`${name}.required must be boolean when provided`);
    if (binding.optional !== undefined && typeof binding.optional !== "boolean")
      errors.push(`${name}.optional must be boolean when provided`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest: value as OpenAiAppManifest };
}
