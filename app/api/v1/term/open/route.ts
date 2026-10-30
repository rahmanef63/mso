import { handleTermOpen } from "@/lib/host/term-service";


// POST /term/open {cols,rows,cwd?} → {id}. Spawns the owner's interactive
// login shell (see lib/host/pty.ts for why no command filter applies here).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleTermOpen(req);
}
