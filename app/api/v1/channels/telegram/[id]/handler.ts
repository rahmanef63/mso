import { NextRequest, NextResponse } from "next/server";
import { ChannelError, dispatchChannelInbound, receiveTelegram } from "@/lib/channels";
import { admitChannelWebhook } from "@/lib/channels/webhook-admission";
import { channelWorkflowRuntime } from "../../workflow-runtime";
import { readSetupJson } from "@/lib/infra/setup-http";


// 202 = acknowledged and intentionally not acted on (bot echo, or a group
// message that is not an owner /discuss command). Telegram should not retry.

export async function handlePostTelegram(req: NextRequest, id: string) {
  try {
    admitChannelWebhook(req, id);
    const body = await readSetupJson(req, 1024 * 1024);
    const event = await receiveTelegram(id, body, req.headers.get("x-telegram-bot-api-secret-token"));
    const dispatched = await dispatchChannelInbound(id, event, channelWorkflowRuntime());
    return NextResponse.json({ ok: true, eventId: event.eventId, ...dispatched });
  } catch (error) {
    const value = error instanceof ChannelError ? error : new ChannelError("invalid_channel_webhook");
    if (value.status === 202) return NextResponse.json({ ok: true, ignored: value.code }, { status: 200 });
    return NextResponse.json({ error: value.code }, { status: value.status });
  }
}
