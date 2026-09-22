import { timingSafeEqual } from "node:crypto";
import { request } from "@/lib/infra/http";
import { ChannelError } from "../errors";
import type { ChannelInboundEvent } from "../types";
import { validateTarget } from "../schema";

const TOKEN = /^\d{5,16}:[A-Za-z0-9_-]{20,}$/;
const SECRET = /^[A-Za-z0-9_-]{1,256}$/;

function token(values: Record<string, string>) {
  const value = values.botToken;
  if (!value || !TOKEN.test(value)) throw new ChannelError("telegram_not_configured", 409);
  return value;
}

function api(values: Record<string, string>, method: string) {
  return `https://api.telegram.org/bot${token(values)}/${method}`;
}

export async function verifyTelegram(values: Record<string, string>) {
  const response = await request(api(values, "getMe"), { headers: { accept: "application/json" } });
  const body = response.body as { ok?: boolean; result?: { id?: number; username?: string } } | null;
  if (!response.ok || !body?.ok || !body.result?.id) throw new ChannelError(`telegram_http_${response.status || 502}`, 502);
  return { detail: `Telegram bot verified as @${body.result.username ?? body.result.id}`, identity: String(body.result.id) };
}

export async function sendTelegramText(values: Record<string, string>, target: string, text: string) {
  validateTarget("telegram", target);
  if (!text || text.length > 4096) throw new ChannelError("invalid_message_text");
  const response = await request(api(values, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ chat_id: target, text }),
  });
  const body = response.body as { ok?: boolean; result?: { message_id?: number } } | null;
  if (!response.ok || !body?.ok) throw new ChannelError(`telegram_http_${response.status || 502}`, 502);
  return { messageId: body.result?.message_id ? String(body.result.message_id) : null };
}

export function verifyTelegramSecret(values: Record<string, string>, supplied: string | null) {
  const expected = values.webhookSecret;
  if (!expected || !SECRET.test(expected) || !supplied || !SECRET.test(supplied)) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeTelegramUpdate(raw: unknown): ChannelInboundEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ChannelError("invalid_telegram_update");
  const update = raw as Record<string, unknown>;
  const updateId = update.update_id;
  if (typeof updateId !== "number" && typeof updateId !== "string") throw new ChannelError("invalid_telegram_update");

  const message = (update.message ?? update.channel_post ?? update.edited_message) as Record<string, unknown> | undefined;
  const callback = update.callback_query as Record<string, unknown> | undefined;
  const callbackMessage = callback?.message as Record<string, unknown> | undefined;
  const source = message ?? callbackMessage;
  const chat = source?.chat as Record<string, unknown> | undefined;
  const from = (message?.from ?? callback?.from) as Record<string, unknown> | undefined;
  const text = typeof message?.text === "string" ? message.text : typeof callback?.data === "string" ? callback.data : undefined;

  return {
    provider: "telegram",
    eventId: String(updateId),
    kind: callback ? "callback" : message ? "message" : "update",
    ...(chat?.id !== undefined ? { target: String(chat.id) } : {}),
    ...(from?.id !== undefined ? { sender: String(from.id) } : {}),
    ...(text ? { text } : {}),
    receivedAt: new Date().toISOString(),
    raw,
  };
}
