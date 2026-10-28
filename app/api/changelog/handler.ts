import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";

const LIMIT = 40_000; // ~60 days of subjects; the file is capped upstream anyway

export async function handleGetChangelog(): Promise<Response> {
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
