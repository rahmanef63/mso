import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listModels } from "@/lib/models";
import { readOAuthBundle, writeOAuthBundle } from "@/lib/config/store";
import { codexModels, ensureFreshCodex } from "@/lib/ai/oauth/codex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Model catalog for the Settings → AI picker + the Browse dialog, sourced from the
// models.dev cache (offline-tolerant: stale cache or empty on a cold offline box).
// Session-gated. ?provider=<slug> filters to one provider to keep the payload small.
// Each row carries capability/pricing meta (context, cost, tools, reasoning); the
// model field stays free-text so an id not in the catalog still works.
export async function GET(req: NextRequest) {
  if (!(await requireSession("owner"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const provider = req.nextUrl.searchParams.get("provider");

  // An OAuth provider's models come from the ACCOUNT, not from models.dev. Its slug
  // ("openai-codex") is local to mso and models.dev has never heard of it, so the
  // filter below matched nothing and the picker came up empty the moment ChatGPT auth
  // was connected — the account's own list had been fetched during OAuth and thrown
  // away. Nothing from the bundle but model IDs is ever returned: the access token
  // stays in the 0600 host file and only ever leaves as an Authorization header.
  if (provider === "openai-codex") {
    const bundle = await readOAuthBundle(provider);
    if (!bundle) return NextResponse.json({ models: [] });
    let fresh = bundle;
    try {
      fresh = await ensureFreshCodex(bundle);
      if (fresh !== bundle) await writeOAuthBundle(provider, fresh);
    } catch {
      // Refresh failed (revoked/offline) — fall through and let the call below fail
      // to an empty list rather than 500 the settings page.
    }
    const ids = await codexModels(fresh);
    return NextResponse.json({
      models: ids.map((id) => ({ ref: `${provider}/${id}`, provider, id, name: id })),
    });
  }

  try {
    const all = await listModels();
    const models = (provider ? all.filter((m) => m.provider === provider) : all).map((m) => ({
      ref: m.ref,
      provider: m.provider,
      // model id = ref minus the "provider/" prefix (ids may contain "/").
      id: m.ref.slice(m.provider.length + 1),
      name: m.name,
      context: m.limit?.context,
      inputCost: m.cost?.input,
      outputCost: m.cost?.output,
      tools: !!m.tool_call,
      reasoning: !!m.reasoning,
      vision: Array.isArray(m.modalities?.input) ? m.modalities.input.includes("image") : false,
    }));
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] }); // offline + no cache → the UI just loses suggestions
  }
}
