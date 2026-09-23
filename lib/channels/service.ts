import { directConnectionValues, integrationSnapshot, resolveIntegration } from "@/lib/infra/connection-service";
import { IntegrationError } from "@/lib/infra/identity";
import { ChannelError } from "./errors";
import { channelProvider, listChannelProviders } from "./registry";
import { parseChannelPatch } from "./schema";
import {
  channelById,
  createChannel,
  deleteChannel,
  readChannelState,
  recordChannelActivity,
  recordChannelCheck,
  updateChannel,
} from "./store";
import type { ChannelInboundEvent, ChannelRecord } from "./types";
import { verifyTelegram, sendTelegramText, verifyTelegramSecret, normalizeTelegramUpdate } from "./providers/telegram";
import {
  discordApplicationMatches,
  normalizeDiscordInteraction,
  sendDiscordText,
  verifyDiscord,
  verifyDiscordSignature,
} from "./providers/discord";

async function values(channel: ChannelRecord) {
  try {
    return await directConnectionValues(channel.provider, {
      user: channel.credential.user,
      connection: channel.credential.connection,
    });
  } catch (error) {
    if (error instanceof IntegrationError) throw new ChannelError(error.code, error.status);
    throw error;
  }
}

function assertEnabled(channel: ChannelRecord) {
  if (!channel.enabled) throw new ChannelError("channel_disabled", 409);
}

export async function channelsSnapshot() {
  const state = await readChannelState();
  const root = await integrationSnapshot();
  const credentials = (await Promise.all(root.users.map(async (profile) => {
    const snapshot = await integrationSnapshot({ user: profile.id });
    return snapshot.connections
      .filter((row) => row.source === "direct" && (row.provider === "telegram" || row.provider === "discord"))
      .map((row) => ({ userLabel: profile.label, ...row }));
  }))).flat();
  const channels = await Promise.all(state.channels.map(async (row) => {
    try {
      const connection = await resolveIntegration(row.provider, row.credential);
      return { ...row, capabilities: channelProvider(row.provider), connection };
    } catch (error) {
      const code = error instanceof IntegrationError ? error.code : "connection_unavailable";
      return { ...row, capabilities: channelProvider(row.provider), connection: { state: "missing", error: code } };
    }
  }));
  return { ...state, providers: listChannelProviders(), credentials, channels };
}

async function assertCredentialRef(input: ReturnType<typeof parseChannelPatch>) {
  try {
    await directConnectionValues(input.provider, { user: input.credential.user, connection: input.credential.connection });
  } catch (error) {
    if (error instanceof IntegrationError) throw new ChannelError(error.code, error.status);
    throw error;
  }
}

export async function createChannelConfig(raw: Record<string, unknown>) {
  const parsed = parseChannelPatch(raw);
  await assertCredentialRef(parsed);
  return createChannel(raw);
}

export async function updateChannelConfig(id: string, expectedRevision: number, raw: Record<string, unknown>) {
  const previous = await channelById(id);
  const parsed = parseChannelPatch(raw, previous);
  await assertCredentialRef(parsed);
  return updateChannel(id, expectedRevision, raw);
}

export const deleteChannelConfig = deleteChannel;

export async function testChannel(id: string) {
  const channel = await channelById(id);
  let ok = false;
  let detail = "Verification failed";
  try {
    const credential = await values(channel);
    const result = channel.provider === "telegram" ? await verifyTelegram(credential) : await verifyDiscord(credential);
    ok = true;
    detail = result.detail;
  } catch (error) {
    detail = error instanceof Error ? error.message : "verification_failed";
  }
  const stored = await recordChannelCheck(id, ok, detail);
  return { ok, detail, channel: stored };
}

export async function sendChannelText(id: string, input: { target?: string; text: string }) {
  const channel = await channelById(id);
  assertEnabled(channel);
  const target = input.target?.trim() || channel.defaultTarget;
  if (!target) throw new ChannelError("channel_target_required");
  const credential = await values(channel);
  const result = channel.provider === "telegram"
    ? await sendTelegramText(credential, target, input.text)
    : await sendDiscordText(credential, target, input.text);
  await recordChannelActivity(id);
  return { provider: channel.provider, target, ...result };
}

export async function receiveTelegram(id: string, raw: unknown, suppliedSecret: string | null): Promise<ChannelInboundEvent> {
  const channel = await channelById(id);
  if (channel.provider !== "telegram") throw new ChannelError("channel_provider_mismatch", 404);
  assertEnabled(channel);
  const credential = await values(channel);
  if (!credential.webhookSecret) throw new ChannelError("telegram_webhook_secret_required", 503);
  if (!verifyTelegramSecret(credential, suppliedSecret)) throw new ChannelError("invalid_webhook_signature", 401);
  return normalizeTelegramUpdate(raw);
}

export async function receiveDiscord(
  id: string,
  bodyText: string,
  timestamp: string | null,
  signature: string | null,
): Promise<{ event: ChannelInboundEvent | null; ping: boolean }> {
  const channel = await channelById(id);
  if (channel.provider !== "discord") throw new ChannelError("channel_provider_mismatch", 404);
  assertEnabled(channel);
  const credential = await values(channel);
  if (!credential.publicKey) throw new ChannelError("discord_public_key_required", 503);
  if (!verifyDiscordSignature(credential, timestamp, signature, bodyText)) throw new ChannelError("invalid_webhook_signature", 401);
  let raw: unknown;
  try { raw = JSON.parse(bodyText); } catch { throw new ChannelError("invalid_discord_interaction"); }
  if (!discordApplicationMatches(credential, raw)) throw new ChannelError("discord_application_mismatch", 401);
  if ((raw as Record<string, unknown>).type === 1) {
    await recordChannelActivity(id);
    return { event: null, ping: true };
  }
  const event = normalizeDiscordInteraction(raw);
  return { event, ping: false };
}
