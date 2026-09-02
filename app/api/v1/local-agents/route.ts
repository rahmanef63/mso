import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { audit, rateLimited } from "@/lib/host";
import { getAgentSession } from "@/lib/agent/session-store";
import { listLocalAgents } from "@/lib/agent/local-agent-directory";
import { endLocalAgentPresence, touchLocalAgentPresence } from "@/lib/agent/local-agent-presence";
import { listLocalAgentInbox, updateLocalAgentMessageState } from "@/lib/agent/local-agent-mailbox";
import { flushLocalAgentQueue, replyLocalAgentMessage, sendLocalAgentMessage } from "@/lib/agent/local-agent-messaging";
import { subscribeLocalAgentMessages } from "@/lib/agent/local-agent-events";
import type { LocalAgentPresenceState } from "@/lib/agent/local-agent-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SSE_HEARTBEAT_MS = 15_000;
const MAX_POST_BODY_BYTES = 128 * 1024;

class LocalAgentBodyTooLarge extends Error {}

async function readBoundedBody(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_POST_BODY_BYTES) throw new LocalAgentBodyTooLarge();
  if (!req.body) throw new Error("invalid_request");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_POST_BODY_BYTES) { await reader.cancel().catch(() => undefined); throw new LocalAgentBodyTooLarge(); }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_request");
  return value as Record<string, unknown>;
}

async function ownerPrincipal(): Promise<{ principal: string; actor: string } | null> {
  const context = await getSessionContext();
  if (context?.role !== "owner") return null;
  const actor = context.session.device_id || "owner";
  return { principal: `cli:${actor}`, actor };
}

async function requireCliSession(principal: string, id: string) {
  const session = await getAgentSession(principal, id);
  if (!session || session.source !== "cli") throw new Error("local agent session not found");
  return session;
}

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "local agent operation failed";
  const status = /not found/i.test(message) ? 404 : /ambiguous/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message.slice(0, 240) }, { status });
}

function presenceState(value: unknown): Exclude<LocalAgentPresenceState, "ended"> {
  const raw = String(value || "idle");
  if (raw === "ready" || raw === "idle" || raw === "busy") return raw;
  throw new Error("local agent state must be ready, idle, or busy");
}

export async function GET(req: NextRequest) {
  const owner = await ownerPrincipal();
  if (!owner) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  const url = req.nextUrl;
  const sessionId = String(url.searchParams.get("session") || "").trim();
  try {
    if (url.searchParams.get("stream") === "1") {
      if (!sessionId) return NextResponse.json({ error: "session_required" }, { status: 400 });
      await requireCliSession(owner.principal, sessionId);
      const encoder = new TextEncoder();
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let closed = false;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, value: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
            } catch {
              closed = true;
            }
          };
          // Subscribe before replaying the durable backlog so a send racing stream setup
          // can be duplicated (client dedupes by message id) but can never be missed.
          unsubscribe = subscribeLocalAgentMessages(sessionId, (message) => send("message", message));
          const backlog = await listLocalAgentInbox(owner.principal, sessionId, { limit: 200 });
          const pendingIds = backlog.filter((row) => row.state !== "read").map((row) => row.id);
          if (pendingIds.length)
            await updateLocalAgentMessageState(owner.principal, sessionId, pendingIds, "delivered");
          for (const row of backlog) send("message", { ...row, state: row.state === "read" ? "read" : "delivered" });
          heartbeat = setInterval(() => {
            if (!closed) {
              try { controller.enqueue(encoder.encode(": ping\n\n")); }
              catch { closed = true; }
            }
          }, SSE_HEARTBEAT_MS);
          req.signal.addEventListener("abort", () => {
            closed = true;
            unsubscribe();
            if (heartbeat) clearInterval(heartbeat);
          }, { once: true });
        },
        cancel() {
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          connection: "keep-alive",
        },
      });
    }

    if (url.searchParams.get("inbox") === "1") {
      if (!sessionId) return NextResponse.json({ error: "session_required" }, { status: 400 });
      return NextResponse.json({
        messages: await listLocalAgentInbox(owner.principal, sessionId, {
          includeRead: url.searchParams.get("includeRead") === "1",
          limit: Number(url.searchParams.get("limit")) || 100,
        }),
      });
    }

    return NextResponse.json({
      agents: await listLocalAgents(owner.principal, {
        currentSessionId: sessionId || undefined,
        includeOffline: url.searchParams.get("includeOffline") === "1",
      }),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(req: NextRequest) {
  const owner = await ownerPrincipal();
  if (!owner) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await readBoundedBody(req); }
  catch (error) {
    if (error instanceof LocalAgentBodyTooLarge) return NextResponse.json({ error: "request_body_too_large" }, { status: 413 });
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const action = String(body.action || "");
  const sessionId = String(body.sessionId || "").trim();
  try {
    if (action === "presence") {
      if (!sessionId) throw new Error("session_required");
      if (rateLimited(`local-agent.presence:${sessionId}`, 120, 60_000))
        return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const state = presenceState(body.state);
      const entry = await touchLocalAgentPresence(
        owner.principal,
        sessionId,
        state,
        String(body.instanceId || ""),
      );
      const delivered = state === "busy" || body.flush === false ? 0 : await flushLocalAgentQueue(owner.principal, sessionId);
      return NextResponse.json({ ok: true, presence: entry, delivered });
    }
    if (action === "end") {
      if (!sessionId) throw new Error("session_required");
      await endLocalAgentPresence(owner.principal, sessionId, String(body.instanceId || ""));
      return NextResponse.json({ ok: true });
    }
    if (action === "ack") {
      if (!sessionId) throw new Error("session_required");
      const ids = Array.isArray(body.messageIds) ? body.messageIds.map(String) : [];
      const messages = await updateLocalAgentMessageState(owner.principal, sessionId, ids, "read");
      return NextResponse.json({ ok: true, messages });
    }
    if (action === "send") {
      if (!sessionId) throw new Error("session_required");
      if (rateLimited(`local-agent.send:${sessionId}`, 60, 60_000))
        return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const result = await sendLocalAgentMessage({
        principal: owner.principal,
        senderSessionId: sessionId,
        target: String(body.target || ""),
        text: String(body.message || ""),
        kind: typeof body.kind === "string" ? body.kind : undefined,
        intent: typeof body.intent === "string" ? body.intent : undefined,
        correlationId: typeof body.correlationId === "string" ? body.correlationId : undefined,
        requiresUserRelay: body.requiresUserRelay === true,
      });
      void audit({
        action: "agent.message",
        actor: owner.actor,
        target: result.target.id,
        detail: `${result.message.kind} ${result.status}`,
        meta: { bytes: Buffer.byteLength(result.message.text, "utf8") },
      });
      return NextResponse.json(result);
    }
    if (action === "reply") {
      if (!sessionId) throw new Error("session_required");
      if (rateLimited(`local-agent.send:${sessionId}`, 60, 60_000))
        return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const result = await replyLocalAgentMessage({
        principal: owner.principal,
        senderSessionId: sessionId,
        replyToMessageId: String(body.replyToMessageId || ""),
        text: String(body.message || ""),
        kind: typeof body.kind === "string" ? body.kind : undefined,
      });
      void audit({ action: "agent.message", actor: owner.actor, target: result.target.id, detail: `reply ${result.status}` });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    return routeError(error);
  }
}
