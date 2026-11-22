import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";
import { listModularFeatures, ModularFeatureError, readModularFeatureAsset } from "./registry";

const JSON_HEADERS = { "Cache-Control": "no-store, private" };
const ASSET_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

export async function handleGetModularFeatures(): Promise<Response> {
  if (IS_DEMO) return json({ schemaVersion: 1, features: [] }, { headers: JSON_HEADERS });
  const context = await getSessionContext();
  if (!context?.session.device_id) {
    return json({ error: "unauthorized" }, { status: 401, headers: JSON_HEADERS });
  }
  return json(listModularFeatures(context.role), { headers: JSON_HEADERS });
}

export async function handleGetModularFeatureAsset(
  id: string,
  segments: string[],
): Promise<Response> {
  if (IS_DEMO) return json({ error: "feature_not_found" }, { status: 404, headers: JSON_HEADERS });
  const context = await getSessionContext();
  if (!context?.session.device_id) {
    return json({ error: "unauthorized" }, { status: 401, headers: JSON_HEADERS });
  }
  try {
    const relPath = segments.join("/");
    const asset = readModularFeatureAsset(id, relPath, context.role);
    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": ASSET_CSP,
        "X-MSO-Feature-Version": asset.version,
      },
    });
  } catch (error) {
    const status = error instanceof ModularFeatureError ? error.status : 400;
    const code = error instanceof ModularFeatureError ? error.message : "feature_asset_failed";
    return json({ error: code }, { status, headers: JSON_HEADERS });
  }
}
