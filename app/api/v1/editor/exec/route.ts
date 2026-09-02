import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { fileStream, statReadable, readFile, writeFile } from "@/lib/host/fs-api";
import {
  blankDoc,
  buildDocFromImage,
  imageSize,
  isDoc,
  runCommands,
  HEADLESS_TOOLS,
  type Doc,
  type Invocation,
} from "@/features/image-editor/server";

// Headless image-editor data API. Applies the editor's command registry to a Doc
// (JSON) with no browser and returns the updated Doc — the "Update" verb of
// editor-document CRUD (same commands the in-browser editor + AI panel use).
// There is no server render: to view a doc, open it in the real editor.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  doc?: Doc;
  path?: string;      // edit a doc FILE in place: read→apply→write atomically (host write-bounds)
  image?: string;     // data URL — builds a fresh doc (stores the data URL)
  imagePath?: string; // host path — builds a fresh doc storing a light path-URL src
  open?: boolean;
  name?: string;
  commands?: Invocation[];
};

const rawUrl = (path: string) => "/api/v1/fs/raw?path=" + encodeURIComponent(path);
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// Probe image dimensions from a host file's leading bytes (no full decode) and
// build a doc whose image-layer src is a light same-origin path-URL.
async function docFromImagePath(path: string, name?: string): Promise<{ doc: Doc; fallback?: boolean }> {
  const info = await statReadable(path);
  const end = Math.min(info.size - 1, 262143);
  const chunks: Buffer[] = [];
  for await (const c of fileStream(info.path, 0, end)) chunks.push(c as Buffer);
  const { width, height, fallback } = imageSize(Buffer.concat(chunks));
  return { doc: buildDocFromImage(rawUrl(info.path), { name, width, height }), fallback };
}

// GET → the command vocabulary (name + description + JSON schema) for `set`.
export async function GET(req: Request) {
  if (!(await verifyAuth(req))) return bad("unauthorized", 401);
  return NextResponse.json({ tools: HEADLESS_TOOLS });
}

export async function POST(req: Request) {
  if (!(await verifyAuth(req))) return bad("unauthorized", 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("invalid json");
  }

  try {
    let doc: Doc;
    let fallback: boolean | undefined;

    if (body.path) {
      // In-place file edit, atomic server-side. If the file EXISTS it must be a
      // valid doc (never clobber a non-doc file); only a MISSING file is seeded.
      let existing: string | null = null;
      try {
        existing = await readFile(body.path);
      } catch {
        existing = null;
      }
      if (existing !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(existing);
        } catch {
          return bad(`"${body.path}" exists but is not JSON — refusing to overwrite`);
        }
        if (!isDoc(parsed)) return bad(`"${body.path}" is not an editor document — refusing to overwrite`);
        doc = parsed;
      } else {
        ({ doc, fallback } = body.imagePath
          ? await docFromImagePath(body.imagePath, body.name)
          : { doc: blankDoc() });
      }
    } else if (body.imagePath && (body.open || !body.doc)) {
      ({ doc, fallback } = await docFromImagePath(body.imagePath, body.name));
    } else if (body.image && (body.open || !body.doc)) {
      doc = buildDocFromImage(body.image, { name: body.name });
    } else if (body.doc) {
      if (!isDoc(body.doc)) return bad("body.doc is not a valid editor document");
      doc = body.doc;
    } else {
      doc = blankDoc();
    }

    const { doc: out, results } = await runCommands(doc, body.commands ?? []);
    // Atomic write-back when editing a file in place (host enforces write-bounds).
    if (body.path) await writeFile(body.path, JSON.stringify(out));

    return NextResponse.json({
      doc: out,
      results,
      ...(body.path ? { written: body.path } : {}),
      ...(fallback ? { dimsFallback: true } : {}),
    });
  } catch (e) {
    return apiError("editor/exec", e);
  }
}
