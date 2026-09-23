import { NextRequest, NextResponse } from "next/server";
import { ChannelError, receiveDiscord } from "@/lib/channels";
import { dispatchChannelInbound } from "@/lib/mcp/channels/dispatch";
import { rateLimitedUntrusted } from "@/lib/host/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (rateLimitedUntrusted(`channel-discord:${id}`, 120, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const length = Number(req.headers.get("content-length"));
    if (Number.isFinite(length) && length > 1024 * 1024) throw new ChannelError("request_too_large", 413);
    const body = await req.text();
    if (Buffer.byteLength(body) > 1024 * 1024) throw new ChannelError("request_too_large", 413);
    const result = await receiveDiscord(id, body, req.headers.get("x-signature-timestamp"), req.headers.get("x-signature-ed25519"));
    if (result.ping) return NextResponse.json({ type: 1 });
    if (!result.event) throw new ChannelError("invalid_discord_interaction");
    const dispatched = await dispatchChannelInbound(id, result.event);
    return NextResponse.json({ type: 4, data: { content: dispatched.workflow ? "Workflow started." : "Received by MSO Channels.", flags: 64 } });
  } catch (error) {
    const value = error instanceof ChannelError ? error : new ChannelError("invalid_channel_interaction");
    return NextResponse.json({ error: value.code }, { status: value.status });
  }
}
