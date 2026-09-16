import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listModels } from "@/lib/models";
import { isFreeModel, providerCatalogId } from "@/lib/models/discovery.js";
import { readOAuthBundle, writeOAuthBundle } from "@/lib/config/store";
import { codexModels, ensureFreshCodex } from "@/lib/ai/oauth/codex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Model catalog for Settings → AI + CLI pickers, sourced from the models.dev cache.
// ?provider=<runtime-slug> applies the registry's catalogId mapping.
// ?free=1 keeps only models with explicit zero input AND output cost.
export async function GET(req: NextRequest) {
  if (!(await requireSession("owner"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const provider = req.nextUrl.searchParams.get("provider");
  const freeOnly = req.nextUrl.searchParams.get("free") === "1";

  // OAuth account models are account-scoped rather than models.dev-scoped. Their
  // pricing is unknown here, so they are never advertised as free.
  if (provider === "openai-codex") {
    const bundle = await readOAuthBundle(provider);
    if (!bundle) return NextResponse.json({ models: [] });
    let fresh = bundle;
    try {
      fresh = await ensureFreshCodex(bundle);
      if (fresh !== bundle) await writeOAuthBundle(provider, fresh);
    } catch {
      // Revoked/offline refresh degrades to an empty catalog rather than breaking Settings.
    }
    if (freeOnly) return NextResponse.json({ models: [] });
    const ids = await codexModels(fresh);
    return NextResponse.json({
      models: ids.map((id) => ({
        ref: `${provider}/${id}`,
        provider,
        id,
        name: id,
        free: false,
        agentReady: true,
      })),
    });
  }

  try {
    const all = await listModels();
    const catalogId = provider ? providerCatalogId(provider) : null;
    const models = all
      .filter((m) => (!provider || m.provider === catalogId) && (!freeOnly || isFreeModel(m)))
      .map((m) => {
        const id = m.ref.slice(m.provider.length + 1);
        const runtimeProvider = provider || m.provider;
        return {
          ref: `${runtimeProvider}/${id}`,
          provider: runtimeProvider,
          id,
          name: m.name,
          context: m.limit?.context,
          inputCost: m.cost?.input,
          outputCost: m.cost?.output,
          tools: !!m.tool_call,
          free: isFreeModel(m),
          agentReady: !!m.tool_call,
          reasoning: !!m.reasoning,
          vision: Array.isArray(m.modalities?.input) ? m.modalities.input.includes("image") : false,
        };
      });
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
