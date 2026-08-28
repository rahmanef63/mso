import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listThreads, getThread, saveThread, deleteThread, type ChatThread } from "@/lib/ai/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Persistent Alfa chat threads (YAML files in ~/.mso/threads/). Session-gated.
//   GET            → list summaries
//   GET  ?id=<id>  → one full thread
//   POST { id, title?, createdAt?, messages[], history[] } → save (create/update)
//   DELETE ?id=<id> → remove
export async function GET(req: NextRequest) {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const t = await getThread(id);
    return t ? NextResponse.json(t) : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ threads: await listThreads() });
}

export async function POST(req: NextRequest) {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Partial<ChatThread>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.id || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "id + messages required" }, { status: 400 });
  }
  const now = Date.now();
  const thread: ChatThread = {
    id: String(body.id),
    title: String(body.title || "").slice(0, 120) || "Untitled",
    createdAt: body.createdAt || now,
    updatedAt: now,
    // Cap runaway size — keep the last 200 of each so a long chat can't bloat the file.
    messages: body.messages.slice(-200),
    history: Array.isArray(body.history) ? body.history.slice(-200) : [],
  };
  await saveThread(thread);
  return NextResponse.json({ ok: true, id: thread.id });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteThread(id);
  return NextResponse.json({ ok: true });
}
