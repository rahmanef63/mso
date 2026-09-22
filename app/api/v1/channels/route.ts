import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { readSetupJson } from "@/lib/infra/setup-http";
import { rateLimited } from "@/lib/host/rate-limit";
import {
  ChannelError,
  channelsSnapshot,
  createChannelConfig,
  deleteChannelConfig,
  sendChannelText,
  testChannel,
  updateChannelConfig,
} from "@/lib/channels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };

const failure = (error: unknown) => {
  const value = error instanceof ChannelError ? error : new ChannelError("channel_operation_failed", 400);
  return NextResponse.json({ error: value.code }, { status: value.status, headers });
};

async function owner() {
  const context = await getSessionContext();
  return context?.role === "owner" ? context : null;
}

export async function GET() {
  if (!(await owner())) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try { return NextResponse.json(await channelsSnapshot(), { headers }); }
  catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  const context = await owner();
  if (!context) return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try {
    const body = await readSetupJson(req, 64 * 1024);
    const action = typeof body.action === "string" ? body.action : "";
    if (rateLimited(`channels:${action}:${context.session.device_id}`, action === "send" ? 60 : 30, 60_000)) {
      throw new ChannelError("rate_limited", 429);
    }
    if (action === "create") {
      if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new ChannelError("invalid_channel_data");
      return NextResponse.json(await createChannelConfig(body.data as Record<string, unknown>), { headers });
    }
    if (action === "update") {
      if (typeof body.id !== "string" || !Number.isSafeInteger(body.expectedRevision) || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
        throw new ChannelError("invalid_channel_update");
      }
      return NextResponse.json(await updateChannelConfig(body.id, Number(body.expectedRevision), body.data as Record<string, unknown>), { headers });
    }
    if (action === "delete") {
      if (typeof body.id !== "string" || !Number.isSafeInteger(body.expectedRevision)) throw new ChannelError("invalid_channel_delete");
      return NextResponse.json(await deleteChannelConfig(body.id, Number(body.expectedRevision)), { headers });
    }
    if (action === "test") {
      if (typeof body.id !== "string") throw new ChannelError("invalid_channel_id");
      return NextResponse.json(await testChannel(body.id), { headers });
    }
    if (action === "send") {
      if (typeof body.id !== "string" || typeof body.text !== "string") throw new ChannelError("invalid_channel_send");
      return NextResponse.json(await sendChannelText(body.id, { text: body.text, ...(typeof body.target === "string" ? { target: body.target } : {}) }), { headers });
    }
    throw new ChannelError("unknown_channel_action");
  } catch (error) {
    return failure(error);
  }
}
