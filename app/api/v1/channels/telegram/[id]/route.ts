import { NextRequest, NextResponse } from "next/server";
import { ChannelError, dispatchChannelInbound, receiveTelegram } from "@/lib/channels";
import { rateLimitedUntrusted } from "@/lib/host/rate-limit";
import { readSetupJson } from "@/lib/infra/setup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (rateLimitedUntrusted(`channel-telegram:${id}`, 120, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const body = await readSetupJson(req, 1024 * 1024);
    const event = await receiveTelegram(id, body, req.headers.get("x-telegram-bot-api-secret-token"));
    const dispatched = await dispatchChannelInbound(id, event);
    return NextResponse.json({ ok: true, eventId: event.eventId, ...dispatched });
  } catch (error) {
    const value = error instanceof ChannelError ? error : new ChannelError("invalid_channel_webhook");
    return NextResponse.json({ error: value.code }, { status: value.status });
  }
}
