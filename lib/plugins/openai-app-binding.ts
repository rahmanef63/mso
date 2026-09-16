export type OpenAiAppBinding = {
  id: string;
  required: boolean;
};

export type OpenAiAppManifest = {
  apps: Record<string, OpenAiAppBinding>;
};

const APP_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REGISTERED_APP_ID = /^(?:plugin_)?asdk_app_[a-z0-9]+$/;
const CONNECTOR_ID = /^connector_[a-z0-9]+$/;
const TEMPLATED_APP_ID = /^templated_apps_[a-z0-9_]+$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isOpenAiAppBindingId(value: unknown): value is string {
  return typeof value === "string" && (
    REGISTERED_APP_ID.test(value) ||
    CONNECTOR_ID.test(value) ||
    TEMPLATED_APP_ID.test(value)
  );
}

export function validateOpenAiAppManifest(value: unknown):
  | { ok: true; manifest: OpenAiAppManifest }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!record(value) || !record(value.apps)) return { ok: false, errors: ["must contain an apps object"] };
  for (const [name, binding] of Object.entries(value.apps)) {
    if (!APP_KEY.test(name)) errors.push(`app key must be kebab-case: ${name}`);
    if (!record(binding)) {
      errors.push(`${name} binding must be an object`);
      continue;
    }
    if (!isOpenAiAppBindingId(binding.id)) errors.push(`${name}.id must be an exact supported OpenAI app/connector id`);
    if (typeof binding.required !== "boolean") errors.push(`${name}.required must be boolean`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest: value as OpenAiAppManifest };
}
