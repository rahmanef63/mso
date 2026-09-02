import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { attachPty, hasPty } from "@/lib/host/terminal-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

// GET /term/stream?id= → SSE of pty output. Replays the session's recent
// buffer first (resume cursor via the standard Last-Event-ID header, so an
// EventSource auto-reconnect is seamless and duplicate-free), then live `data`
// events (base64 chunks — SSE frames are line-oriented, raw VT bytes are not),
// then one final `exit` event when the shell dies. Unknown session → 400,
// which EventSource treats as fatal (no useless retry loop after a restart).
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id || !hasPty(id))
    return NextResponse.json({ error: "Unknown terminal session" }, { status: 400 });
  const last = req.headers.get("last-event-id");
  const from = last ? parseInt(last, 10) || 0 : 0;

  const enc = new TextEncoder();
  let detach: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        detach?.();
      };
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup(); // client went away mid-enqueue
        }
      };
      const end = () => {
        if (closed) return;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      try {
        detach = attachPty(id, from, {
          onData: (chunk, off) =>
            send(`id: ${off}\nevent: data\ndata: ${Buffer.from(chunk, "utf8").toString("base64")}\n\n`),
          onExit: (code) => {
            send(`event: exit\ndata: ${code}\n\n`);
            end();
          },
        });
      } catch {
        // Session reaped between hasPty() and attach — treat as exited.
        send(`event: exit\ndata: -1\n\n`);
        end();
        return;
      }
      if (!closed) heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      detach?.();
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
