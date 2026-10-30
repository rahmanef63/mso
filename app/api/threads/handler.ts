import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listThreads, getThread, saveThread, deleteThread, renameThread, type ChatThread } from "@/lib/ai/threads";


// Persistent Alfa chat threads (YAML files in ~/.mso/threads/). Session-gated.
//   GET            → list summaries
//   GET  ?id=<id>  → one full thread
//   POST { id, title?, createdAt?, messages[], history[] } → save (create/update)
//   DELETE ?id=<id> → remove
//   PATCH { id, title } → rename thread

const THREAD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function handleGetThreads(req: NextRequest): Promise<Response> {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const t = await getThread(id);
    return t ? NextResponse.json(t) : NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ threads: await listThreads() });
}

export async function handlePostThreads(req: NextRequest): Promise<Response> {
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

export async function handleDeleteThreads(req: NextRequest): Promise<Response> {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteThread(id);
  return NextResponse.json({ ok: true });
}

export async function handlePatchThreads(req: NextRequest): Promise<Response> {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { id?: unknown; title?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || !THREAD_ID.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "invalid title" }, { status: 400 });
  }
  const title = body.title.trim().slice(0, 120);
  try {
    const thread = await renameThread(id, title);
    if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, thread });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "bad_request" }, { status: 400 });
  }
}
