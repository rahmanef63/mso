import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listModels } from "@/lib/models";
import { isFreeModel, providerCatalogId } from "@/lib/models/discovery.js";
import { readConfig, readOAuthBundle, safeProviderId, writeOAuthBundle } from "@/lib/config/store";
import { codexModels, ensureFreshCodex } from "@/lib/ai/oauth/codex";

export async function handleGetModels(req: NextRequest): Promise<Response> {
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

  // A custom endpoint has no models.dev entry, so the picker reads the ids the
  // owner declared/discovered for it instead of returning an empty catalog.
  if (provider) {
    try {
      const conn = (await readConfig()).customProviders?.[safeProviderId(provider)];
      if (conn) {
        const models = freeOnly ? [] : (conn.models ?? []).map((id) => ({
          ref: `${provider}/${id}`,
          provider,
          id,
          name: id,
          free: false,
          agentReady: false,
        }));
        return NextResponse.json({ models });
      }
    } catch {
      // An invalid provider id falls through to the catalog filter below.
    }
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
          // `provider` alone is null when the caller passes no ?provider= filter; the
          // catalog must still name each model's real provider.
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
