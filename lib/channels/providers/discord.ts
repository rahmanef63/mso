import { createPublicKey, verify } from "node:crypto";
import { request } from "@/lib/infra/http";
import { ChannelError } from "../errors";
import type { ChannelInboundEvent } from "../types";
import { validateTarget } from "../schema";

const BOT_TOKEN = /^[^\s\x00-\x1f\x7f]{24,256}$/;
const PUBLIC_KEY = /^[0-9a-f]{64}$/i;
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function token(values: Record<string, string>) {
  const value = values.botToken;
  if (!value || !BOT_TOKEN.test(value)) throw new ChannelError("discord_not_configured", 409);
  return value;
}

const headers = (values: Record<string, string>) => ({
  authorization: `Bot ${token(values)}`,
  accept: "application/json",
  "user-agent": "MSO-Channels/1.0",
});

export async function verifyDiscord(values: Record<string, string>) {
  const response = await request("https://discord.com/api/v10/users/@me", { headers: headers(values) });
  const body = response.body as { id?: string; username?: string } | null;
  if (!response.ok || !body?.id) throw new ChannelError(`discord_http_${response.status || 502}`, 502);
  return { detail: `Discord bot verified as ${body.username ?? body.id}`, identity: body.id };
}

export async function sendDiscordText(values: Record<string, string>, target: string, text: string) {
  validateTarget("discord", target);
  if (!text || text.length > 2000) throw new ChannelError("invalid_message_text");
  const response = await request(`https://discord.com/api/v10/channels/${target}/messages`, {
    method: "POST",
    headers: { ...headers(values), "content-type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  const body = response.body as { id?: string } | null;
  if (!response.ok || !body?.id) throw new ChannelError(`discord_http_${response.status || 502}`, 502);
  return { messageId: body.id };
}

export function verifyDiscordSignature(values: Record<string, string>, timestamp: string | null, signature: string | null, body: string) {
  const keyHex = values.publicKey;
  if (!keyHex || !PUBLIC_KEY.test(keyHex) || !timestamp || !signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(keyHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export function normalizeDiscordInteraction(raw: unknown): ChannelInboundEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ChannelError("invalid_discord_interaction");
  const row = raw as Record<string, unknown>;
  const id = row.id;
  if (typeof id !== "string") throw new ChannelError("invalid_discord_interaction");
  const data = row.data as Record<string, unknown> | undefined;
  const member = row.member as Record<string, unknown> | undefined;
  const memberUser = member?.user as Record<string, unknown> | undefined;
  const user = (row.user as Record<string, unknown> | undefined) ?? memberUser;
  const type = Number(row.type);
  const kind = type === 2 ? "command" : type === 3 ? "component" : type === 5 ? "modal" : "interaction";
  const text = typeof data?.name === "string" ? data.name : typeof data?.custom_id === "string" ? data.custom_id : undefined;
  return {
    provider: "discord",
    eventId: id,
    kind,
    ...(typeof row.channel_id === "string" ? { target: row.channel_id } : {}),
    ...(typeof user?.id === "string" ? { sender: user.id } : {}),
    ...(text ? { text } : {}),
    receivedAt: new Date().toISOString(),
    raw,
  };
}

export function discordApplicationMatches(values: Record<string, string>, raw: unknown) {
  if (!values.applicationId) return true;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).application_id === values.applicationId;
}
