import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";

// Serves docs/CHANGELOG.md so Settings → Account → About can show "What's new" in the running
// app. The point of the whole thing: a shipped change should be visible where the
// owner already is, not only in a terminal they would have to go and open.
//
// Session-gated like every other read here. The file is generated from git subjects,
// so it carries nothing secret — but it does enumerate what this deployment is, and
// that is not something an unauthenticated visitor needs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 40_000; // ~60 days of subjects; the file is capped upstream anyway

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // process.cwd() is the app dir — the same anchor app/api/skills uses.
  const file = path.join(process.cwd(), "docs", "CHANGELOG.md");
  const md = await fs.readFile(file, "utf8").catch(() => null);
  if (md === null) {
    // Not an error: a checkout that has never run the generator simply has none.
    return NextResponse.json({ markdown: "", generated: false });
  }
  return NextResponse.json({ markdown: md.slice(0, LIMIT), generated: true });
}
