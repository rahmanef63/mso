import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listMemories, addMemory, removeMemory } from "@/lib/agent/legacy-owner-memory";


// Alfa's cross-session memory (facts recalled into the system prompt). Session-gated.
//   GET → list · POST { text } → add · DELETE ?id=<id> → remove

export async function handleGetMemory(): Promise<Response> {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ memories: await listMemories() });
}

export async function handlePostMemory(req: NextRequest): Promise<Response> {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  return NextResponse.json({ ok: true, memory: await addMemory(body.text) });
}

export async function handleDeleteMemory(req: NextRequest): Promise<Response> {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await removeMemory(id);
  return NextResponse.json({ ok: true });
}
