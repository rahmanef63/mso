import { json } from "@/lib/api/route";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import {
  apiError,
  invalidRequest,
  optionalString,
  readJson,
  requireInt,
  requireString,
} from "@/lib/host/request-api";
import { audit } from "@/lib/host/audit-api";
import { closePty, openPty, resizePty, writePty } from "@/lib/host/terminal-api";
import { rateLimited } from "@/lib/host/limits-api";

const OPEN_MAX = 20;
const OPEN_WINDOW_MS = 60_000;

export async function handleTermClose(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return json({ error: "unauthorized" }, 401);

  const actor = await getSessionActor();
  if (!actor) return json({ error: "unauthorized" }, 401);
  const body = await readJson(req);
  const id = requireString(body, "id");
  if (id === null) return invalidRequest("id");
  try {
    const killed = closePty(id, actor);
    if (killed) {
      audit({ action: "term.close", actor, target: `pty ${id.slice(0, 8)}`, ok: true });
    }
    return json({ ok: true });
  } catch (e) {
    return apiError("term/close", e);
  }
}

export async function handleTermInput(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return json({ error: "unauthorized" }, 401);

  const actor = await getSessionActor();
  if (!actor) return json({ error: "unauthorized" }, 401);
  const body = await readJson(req);
  const id = requireString(body, "id");
  if (id === null) return invalidRequest("id");
  const data = requireString(body, "data", { allowEmpty: true });
  if (data === null) return invalidRequest("data");
  try {
    writePty(id, actor, data);
    return json({ ok: true });
  } catch (e) {
    return apiError("term/input", e);
  }
}

export async function handleTermOpen(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return json({ error: "unauthorized" }, 401);

  const actor = await getSessionActor();
  if (rateLimited(`term:${actor ?? "anon"}`, OPEN_MAX, OPEN_WINDOW_MS)) {
    audit({ action: "term.open", actor, ok: false, detail: "rate-limited" });
    return json({ error: "Too many terminal sessions, slow down" }, 429);
  }

  const body = await readJson(req);
  const cols = requireInt(body, "cols", 2, 500);
  if (cols === null) return invalidRequest("cols");
  const rows = requireInt(body, "rows", 2, 500);
  if (rows === null) return invalidRequest("rows");
  const cwd = optionalString(body, "cwd");
  if (cwd === null) return invalidRequest("cwd");
  try {
    if (!actor) return json({ error: "unauthorized" }, 401);
    const { id, cwd: dir } = await openPty({ cols, rows, cwd, owner: actor });
    audit({
      action: "term.open",
      actor,
      target: dir,
      ok: true,
      detail: `pty ${id.slice(0, 8)} ${cols}x${rows}`,
    });
    return json({ id });
  } catch (e) {
    audit({ action: "term.open", actor, ok: false, detail: String(e) });
    return apiError("term/open", e);
  }
}

export async function handleTermResize(req: Request): Promise<Response> {
  if (!(await verifyAuth(req)))
    return json({ error: "unauthorized" }, 401);

  const actor = await getSessionActor();
  if (!actor) return json({ error: "unauthorized" }, 401);
  const body = await readJson(req);
  const id = requireString(body, "id");
  if (id === null) return invalidRequest("id");
  const cols = requireInt(body, "cols", 2, 500);
  if (cols === null) return invalidRequest("cols");
  const rows = requireInt(body, "rows", 2, 500);
  if (rows === null) return invalidRequest("rows");
  try {
    resizePty(id, actor, cols, rows);
    return json({ ok: true });
  } catch (e) {
    return apiError("term/resize", e);
  }
}
