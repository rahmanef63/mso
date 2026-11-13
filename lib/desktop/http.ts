import "server-only";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { apiError, invalidRequest, readJson, requireString } from "@/lib/host/request-api";
import {
  desktopLifecycle,
  listDesktopContainers,
  screenshotDesktop,
} from "@/lib/desktop/observer";
import {
  parseContainerId,
  parseLifecycleAction,
  parseLogLines,
} from "@/lib/desktop/contracts";

// Thin gate layer for /api/v1/desktop/*. Everything that knows how to talk to a
// container lives in lib/desktop/observer.ts; this file only decides who may ask
// and which of the five fixed questions they asked. There is deliberately no
// route that accepts a command.
//
// `GET /api/v1/desktop/containers` and the screenshot read are viewer-or-owner
// reads (role policy lives in lib/agent/server.ts); the lifecycle POST adds its own
// rate limit and audit entry because it changes host state.

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function handleGetDesktopContainers(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const actor = await getSessionActor();
  if (rateLimited(`desktop-containers:${actor ?? "unknown"}`, 60, 60_000)) {
    return Response.json({ error: "too many container reads" }, { status: 429 });
  }
  try {
    return Response.json({ containers: await listDesktopContainers() }, { headers: NO_STORE });
  } catch (error) {
    return apiError("desktop/containers", error);
  }
}

export async function handleGetDesktopScreenshot(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const actor = await getSessionActor();
  // A screenshot is a comparatively expensive `docker exec` that also returns a
  // whole frame; a UI that polls it must be told no eventually.
  if (rateLimited(`desktop-screenshot:${actor ?? "unknown"}`, 30, 60_000)) {
    return Response.json({ error: "too many screenshot reads" }, { status: 429 });
  }
  const query = new URL(req.url).searchParams;
  const rawContainer = query.get("container");
  if (!rawContainer) return invalidRequest("container");
  // Validate at the HTTP boundary as well as inside the observer. The observer is the
  // authority, but a request this wrong must be refused before any code path can be
  // reached that forgot to ask it - and this is where the 400 is cheap.
  let container: string;
  try {
    container = parseContainerId(rawContainer);
  } catch (error) {
    return apiError("desktop/screenshot", error, { status: 400 });
  }
  try {
    const png = await screenshotDesktop(container, query.get("screen") ?? "");
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(png.length),
        "cache-control": "no-store",
        // A PNG is an image, never a document: stop a crafted container from
        // getting its bytes sniffed into something the browser would execute.
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    // A HostError from validation is a 400 with the message; everything else is
    // logged and generic through apiError.
    return apiError("desktop/screenshot", error, { status: 400 });
  }
}

export async function handlePostDesktopLifecycle(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const actor = await getSessionActor();
  if (rateLimited(`desktop-lifecycle:${actor ?? "unknown"}`, 12, 60_000)) {
    return Response.json({ error: "too many lifecycle actions" }, { status: 429 });
  }

  const body = await readJson(req);
  const rawContainer = requireString(body, "container");
  if (!rawContainer) return invalidRequest("container");
  const rawAction = requireString(body, "action");
  if (!rawAction) return invalidRequest("action");

  // `lines` is optional and only meaningful for `logs`. A wrong type is a client
  // error, not a silently ignored field.
  const rawLines = (body as Record<string, unknown>).lines;
  if (rawLines !== undefined && typeof rawLines !== "number") return invalidRequest("lines");

  let container: string;
  let action;
  try {
    container = parseContainerId(rawContainer);
    action = parseLifecycleAction(rawAction);
  } catch (error) {
    return apiError("desktop/lifecycle", error, { status: 400 });
  }

  try {
    const result = await desktopLifecycle(container, action, {
      lines: action === "logs" ? parseLogLines(rawLines as number | undefined) : undefined,
    });
    await audit({
      action: "desktop.lifecycle",
      actor,
      target: result.container,
      detail: action,
      // The verb returned success. A missing readback is not a failed action, so it
      // is recorded separately instead of being folded into `ok`.
      ok: true,
      meta: { action, stateReadback: result.state !== null },
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    await audit({
      action: "desktop.lifecycle",
      actor,
      target: container,
      detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
      ok: false,
      meta: { action },
    });
    return apiError("desktop/lifecycle", error, { status: 400 });
  }
}
