import { identity, metadataOnly, IntegrationError } from "@/lib/infra/identity";
import { ChannelError } from "./errors";
import { CHANNEL_PROVIDER_IDS, type ChannelProviderId, type ChannelRecord } from "./types";

const SECRETISH = /(token|secret|password|passphrase|authorization|cookie)/i;
function assertNoSecrets(value: unknown, depth = 0): void {
  if (depth > 12) throw new ChannelError("channel_config_too_deep");
  if (Array.isArray(value)) { value.forEach((item) => assertNoSecrets(item, depth + 1)); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRETISH.test(key)) throw new ChannelError("secret_input_forbidden");
    assertNoSecrets(child, depth + 1);
  }
}

const clean = (value: unknown, label: string, max = 120) => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new ChannelError(`invalid_${label}`);
  }
  return value.trim();
};

export function isChannelProvider(value: unknown): value is ChannelProviderId {
  return typeof value === "string" && (CHANNEL_PROVIDER_IDS as readonly string[]).includes(value);
}

export function validateTarget(provider: ChannelProviderId, target: string) {
  if (provider === "telegram") {
    if (!/^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(target)) throw new ChannelError("invalid_telegram_target");
    return target;
  }
  if (!/^\d{15,22}$/.test(target)) throw new ChannelError("invalid_discord_target");
  return target;
}

export function parseChannelPatch(
  raw: Record<string, unknown>,
  previous?: ChannelRecord,
): Omit<ChannelRecord, "id" | "createdAt" | "updatedAt" | "lastCheck" | "lastActivityAt"> {
  assertNoSecrets(raw);
  try { metadataOnly(raw); } catch (error) { if (error instanceof IntegrationError) throw new ChannelError("secret_input_forbidden"); throw error; }
  const providerRaw = raw.provider ?? previous?.provider;
  if (!isChannelProvider(providerRaw)) throw new ChannelError("invalid_provider");

  const credentialRaw = raw.credential ?? previous?.credential;
  if (!credentialRaw || typeof credentialRaw !== "object" || Array.isArray(credentialRaw)) throw new ChannelError("credential_required");
  const credential = credentialRaw as Record<string, unknown>;
  const user = identity(credential.user, "user");
  const connection = identity(credential.connection, "connection");

  const name = raw.name === undefined && previous ? previous.name : clean(raw.name, "name");
  const enabled = raw.enabled === undefined ? previous?.enabled ?? true : raw.enabled;
  if (typeof enabled !== "boolean") throw new ChannelError("invalid_enabled");

  const targetRaw = raw.defaultTarget === undefined ? previous?.defaultTarget : raw.defaultTarget;
  let defaultTarget: string | undefined;
  if (targetRaw !== undefined && targetRaw !== null && targetRaw !== "") {
    defaultTarget = validateTarget(providerRaw, clean(targetRaw, "target", 128));
  }

  const workflowRaw = raw.workflowId === undefined ? previous?.workflowId : raw.workflowId;
  let workflowId: string | undefined;
  if (workflowRaw !== undefined && workflowRaw !== null && workflowRaw !== "") {
    workflowId = clean(workflowRaw, "workflow", 96);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(workflowId)) throw new ChannelError("invalid_workflow");
  }

  return {
    name,
    provider: providerRaw,
    credential: { user, connection },
    enabled,
    ...(defaultTarget ? { defaultTarget } : {}),
    ...(workflowId ? { workflowId } : {}),
  };
}
