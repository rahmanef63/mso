import { handleTermInput } from "@/lib/host/term-service";


// POST /term/input {id,data} → raw keystrokes into the pty. Not audited and
// not command-filtered by design — see lib/host/pty.ts (owner shell; the
// auditable boundary is session open/close). No rate limit: a fast typist or
// a paste easily outruns any sane per-minute cap.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleTermInput(req);
}
