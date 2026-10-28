import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { hostCredentialStore, readConfig, safeProviderId } from "@/lib/config/store";
import { discoverEndpointModels } from "@/lib/models/discover.js";
import { assertSafeUrl } from "@/lib/host/ssrf";

type DiscoverBody = { provider?: string; baseURL?: string; apiKey?: string; protocol?: string };

export async function handlePostDiscover(req: NextRequest): Promise<Response> {
  if (!(await requireSession("owner"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DiscoverBody;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || [body.provider, body.baseURL, body.apiKey].some((v) => v !== undefined && typeof v !== "string")
      || (body.protocol !== undefined && body.protocol !== "openai" && body.protocol !== "anthropic")) {
      throw new Error("invalid");
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let baseUrl: string;
  let apiKey: string;
  let protocol: "openai" | "anthropic";
  if (body.provider !== undefined) {
    let slug: string;
    try {
      slug = safeProviderId(body.provider.trim());
    } catch {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    const conn = (await readConfig()).customProviders?.[slug];
    if (!conn) return NextResponse.json({ error: `"${slug}" is not a custom provider` }, { status: 400 });
    baseUrl = conn.baseUrl;
    protocol = conn.protocol === "anthropic" ? "anthropic" : "openai";
    apiKey = (await hostCredentialStore().getKey(undefined, slug)) ?? "";
    if (!apiKey) return NextResponse.json({ ok: false, error: `no stored API key for "${slug}"` });
  } else {
    if (!body.baseURL?.trim() || !body.apiKey?.trim()) {
      return NextResponse.json({ error: "baseURL and apiKey are required" }, { status: 400 });
    }
    try {
      baseUrl = assertSafeUrl(body.baseURL.trim()).toString().replace(/\/$/, "");
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    apiKey = body.apiKey.trim();
    protocol = body.protocol === "anthropic" ? "anthropic" : "openai";
  }

  try {
    const models = await discoverEndpointModels({ baseUrl, apiKey, protocol });
    return NextResponse.json({ ok: true, count: models.length, models });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}
