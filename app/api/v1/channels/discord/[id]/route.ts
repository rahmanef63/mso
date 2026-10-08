import { readRequestText, RequestBodyError } from "@/lib/security/request-body";
import { NextRequest, NextResponse } from "next/server";
import { ChannelError, dispatchChannelInbound, receiveDiscord } from "@/lib/channels";
import { admitChannelWebhook } from "@/lib/channels/webhook-admission";
import { channelWorkflowRuntime } from "../../workflow-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    admitChannelWebhook(req, id);
    const body = await readRequestText(req, 1024 * 1024);
    const result = await receiveDiscord(id, body, req.headers.get("x-signature-timestamp"), req.headers.get("x-signature-ed25519"));
    if (result.ping) return NextResponse.json({ type: 1 });
    if (!result.event) throw new ChannelError("invalid_discord_interaction");
    const dispatched = await dispatchChannelInbound(id, result.event, channelWorkflowRuntime());
    return NextResponse.json({ type: 4, data: { content: dispatched.workflow ? "Workflow started." : "Received by MSO Channels.", flags: 64 } });
  } catch (error) {
    const value = error instanceof ChannelError ? error : error instanceof RequestBodyError ? new ChannelError(error.message, error.status) : new ChannelError("invalid_channel_interaction");
    return NextResponse.json({ error: value.code }, { status: value.status });
  }
}
