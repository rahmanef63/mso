import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { subscribeLocalAgentMessages } from "./local-agent-events";
import { listLocalAgentInbox, updateLocalAgentMessageState } from "./local-agent-mailbox";

export function localAgentStream(principal: string, sessionId: string, session: SessionPayload, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let authorityTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false, pendingBytes = 0;
  let delivery = Promise.resolve();
  let end = () => {};
  const cleanup = () => {
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    clearInterval(authorityTimer);
    signal.removeEventListener("abort", end);
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      end = () => { if (closed) return; cleanup(); try { controller.close(); } catch { /* Already closed. */ } };
      const authorized = async () => {
        const valid = await liveSessionAuthorized(session, "owner").catch(() => false);
        if (!valid) end();
        return valid && !closed;
      };
      const send = (frame: string) => {
        if (closed) return;
        const bytes = encoder.encode(frame);
        if ((controller.desiredSize ?? 0) < bytes.byteLength) { end(); return; }
        try { controller.enqueue(bytes); } catch { end(); }
      };
      const deliver = (value: unknown) => {
        const frame = `event: message\ndata: ${JSON.stringify(value)}\n\n`, bytes = Buffer.byteLength(frame);
        pendingBytes += bytes;
        if (pendingBytes > 256 * 1024) { end(); return; }
        delivery = delivery.then(async () => { if (await authorized()) send(frame); }).finally(() => { pendingBytes -= bytes; });
      };
      signal.addEventListener("abort", end, { once: true });
      if (signal.aborted || !await authorized()) { end(); return; }
      // Subscribe before replay so racing messages are never missed; clients deduplicate ids.
      unsubscribe = subscribeLocalAgentMessages(sessionId, deliver);
      heartbeat = setInterval(() => send(": ping\n\n"), 15_000);
      authorityTimer = setInterval(() => { void authorized(); }, 1000);
      try {
        const backlog = await listLocalAgentInbox(principal, sessionId, { limit: 200 });
        if (!await authorized()) return;
        const pendingIds = backlog.filter((row) => row.state !== "read").map((row) => row.id);
        if (pendingIds.length) await updateLocalAgentMessageState(principal, sessionId, pendingIds, "delivered");
        for (const row of backlog) deliver({ ...row, state: row.state === "read" ? "read" : "delivered" });
      } catch { end(); }
    },
    cancel: cleanup,
  }, new ByteLengthQueuingStrategy({ highWaterMark: 256 * 1024 }));
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } });
}
