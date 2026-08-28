import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The VNC password for the Camoufox display, handed to an ALREADY-authenticated
// cockpit session so the browser window does not prompt on every open.
//
// This does not weaken anything. The password exists to stop OTHER LOCAL processes
// on this box (agents, anything the operator runs) from opening a keyboard-and-mouse
// channel into a logged-in browser — x11vnc binds loopback, so that is the threat it
// answers. A local process cannot read the cockpit's DOM, and anyone who CAN read it
// already holds a session that reaches /api/v1/exec, i.e. a full host shell. So the
// value is worth strictly less to whoever can see it here than what they already have.
//
// Plaintext file, written beside the x11vnc passwd blob (x11vnc's own format is not
// meant to be read back). 0600, never in the repo, never in env.
const PASSWD_FILE = process.env.CAMOUFOX_VNC_PASSWD_TEXT
  ?? path.join(os.homedir(), ".vnc/passwd.txt");

export async function GET() {
  // Demo has no host, no display and no session — never hand out a credential there.
  if (IS_DEMO) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  if (!(await requireSession("operator"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const password = (await fs.readFile(PASSWD_FILE, "utf8").catch(() => "")).trim();
  // Absent file = the operator has not set one. Say so plainly rather than 500 — the
  // browser window falls back to letting noVNC prompt.
  if (!password) return NextResponse.json({ password: null, reason: "no_password_file" });
  return NextResponse.json({ password });
}
