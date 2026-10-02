import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  readConfig,
  writeConfig,
  hostCredentialStore,
  isBuiltinProvider,
  slugifyProvider,
  upsertCustomProvider,
  removeCustomProvider,
  removeOAuthBundle,
  safeProviderId,
} from "@/lib/config/store";
import { PROVIDERS } from "@/lib/models";
import { defaultModelFor } from "@/lib/models/defaults";
import { resolveSafeProviderEndpoint } from "@/lib/host/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mask = (k: string) => (k ? `${k.slice(0, 6)}…${k.slice(-4)}` : "");

// GET → masked config + the list of connected providers (built-in-with-key +
// custom). POST → set a built-in provider/model/key, OR add a custom provider.
// DELETE ?provider=slug → forget a provider (its key + custom wiring). Session-gated;
// raw keys never leave the server.

export async function GET() {
  if (!(await requireSession("owner"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cfg = await readConfig();
  const provider = cfg.provider || DEFAULT_PROVIDER;
  const keys = cfg.keys ?? {};
  const custom = cfg.customProviders ?? {};
  const oauth = cfg.oauthTokens ?? {};
  // Masked shows only a locally-stored key; hasApiKey also honours an env fallback.
  const stored = keys[provider] ?? (provider === "anthropic" ? cfg.anthropicApiKey : undefined) ?? "";
  const key = stored || (await hostCredentialStore().getKey(undefined, provider)) || "";

  const connected = Object.fromEntries(await Promise.all(Object.keys(PROVIDERS).map(async (id) =>
    [id, Boolean(await hostCredentialStore().getKey(undefined, id))] as const)));
  const ids = new Set([...Object.keys(keys), ...Object.keys(custom), ...Object.keys(oauth),
    ...Object.keys(connected).filter((id) => connected[id])]);
  const providers = [...ids].sort().map((id) => ({
    id,
    kind: oauth[id] ? "oauth" : isBuiltinProvider(id) ? "builtin" : "custom",
    hasKey: !!keys[id] || !!oauth[id] || connected[id] === true,
    masked: oauth[id] ? "signed in" : mask(keys[id] ?? ""),
    baseUrl: custom[id]?.baseUrl,
    protocol: custom[id]?.protocol,
    models: custom[id]?.models,
  }));

  return NextResponse.json({
    provider,
    model: cfg.model || defaultModelFor(provider),
    hasApiKey: key.length > 0,
    apiKeyMasked: stored ? mask(stored) : "",
    providers,
    tokenSaver: cfg.tokenSaver ?? "off",
  });
}

type CustomBody = { name?: string; baseURL?: string; baseUrl?: string; apiKey?: string; protocol?: string; models?: string[] };

export async function POST(req: NextRequest) {
  if (!(await requireSession("owner"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: {
    apiKey?: string;
    anthropicApiKey?: string;
    model?: string;
    provider?: string;
    customProvider?: CustomBody;
    tokenSaver?: string;
    // Provider credential management can be separated from active model selection.
    // Existing callers default to select=true; CLI `mso models add` sends false.
    select?: boolean;
  };
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || [body.provider, body.model, body.apiKey, body.anthropicApiKey, body.tokenSaver].some((v) => v !== undefined && typeof v !== "string")
      || (body.select !== undefined && typeof body.select !== "boolean")
      || (body.model !== undefined && !body.model.trim())) throw new Error("invalid");
    if (body.provider !== undefined) safeProviderId(body.provider.trim());
    if (body.customProvider !== undefined) {
      const c = body.customProvider;
      if (!c || typeof c !== "object" || Array.isArray(c)
        || [c.name, c.baseURL, c.baseUrl, c.apiKey].some((v) => v !== undefined && typeof v !== "string")
        || (c.protocol !== undefined && c.protocol !== "openai" && c.protocol !== "anthropic")
        || (c.models !== undefined && (!Array.isArray(c.models) || c.models.some((m) => typeof m !== "string")))) throw new Error("invalid");
      slugifyProvider(c.name ?? "");
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Token-saver-only update (independent of provider — don't touch the selection).
  if (typeof body.tokenSaver === "string" && !body.provider && !body.customProvider && body.apiKey === undefined) {
    const v = body.tokenSaver;
    await writeConfig({ tokenSaver: v === "caveman" || v === "ponytail" ? v : "off" });
    return NextResponse.json({ ok: true });
  }

  // ── Add a custom provider ───────────────────────────────────────────────────
  if (body.customProvider) {
    const c = body.customProvider;
    const slug = slugifyProvider(String(c.name ?? ""));
    if (!slug) return NextResponse.json({ error: "Provider name is required" }, { status: 400 });
    if (isBuiltinProvider(slug) || slug === "openai-codex") {
      return NextResponse.json({ error: `"${slug}" is a built-in provider — choose another name` }, { status: 400 });
    }
    if (!c.apiKey || !c.apiKey.trim()) return NextResponse.json({ error: "API key is required" }, { status: 400 });
    let safe: URL;
    try {
      safe = (await resolveSafeProviderEndpoint(String(c.baseURL ?? c.baseUrl ?? ""))).url;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const protocol = c.protocol === "anthropic" ? "anthropic" : "openai";
    const models = (c.models ?? []).map((m) => String(m).trim()).filter(Boolean);
    await upsertCustomProvider(slug, {
      baseUrl: safe.toString().replace(/\/$/, ""),
      protocol,
      ...(models.length ? { models } : {}),
    });
    await hostCredentialStore().setKey(undefined, slug, c.apiKey.trim());
    const model = body.model?.trim() || models[0];
    const selected = body.select !== false && Boolean(model);
    if (selected) {
      await writeConfig({ provider: slug, model });
    }
    return NextResponse.json({ ok: true, slug, selected });
  }

  // ── Set a built-in provider / model / key ──────────────────────────────────
  const cfg = await readConfig();
  const provider = (body.provider ?? (body.anthropicApiKey !== undefined ? "anthropic" : cfg.provider) ?? DEFAULT_PROVIDER).trim();
  if (!isBuiltinProvider(provider) && provider !== "openai-codex" && !Object.hasOwn(cfg.customProviders ?? {}, provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  if (body.select !== false) {
    const model = body.model?.trim() || (provider === cfg.provider ? cfg.model : undefined)
      || cfg.customProviders?.[provider]?.models?.[0] || (isBuiltinProvider(provider) ? defaultModelFor(provider) : undefined);
    if (!model) return NextResponse.json({ error: "Select a model for this provider" }, { status: 400 });
    await writeConfig({ provider, model });
  }

  // Key routes through the per-provider store. Empty string clears it (incl. the
  // legacy anthropicApiKey alias) so a cleared key doesn't linger.
  const apiKey = body.apiKey ?? body.anthropicApiKey;
  if (typeof apiKey === "string") {
    const store = hostCredentialStore();
    if (apiKey.trim()) {
      await store.setKey(undefined, provider, apiKey.trim());
    } else {
      await store.deleteKey(undefined, provider);
      if (provider === "anthropic") await writeConfig({ anthropicApiKey: undefined });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireSession("owner"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const slug = new URL(req.url).searchParams.get("provider")?.trim();
  if (!slug) return NextResponse.json({ error: "provider required" }, { status: 400 });
  await hostCredentialStore().deleteKey(undefined, slug);
  await removeCustomProvider(slug);
  await removeOAuthBundle(slug);
  // Reset a deleted selection; the default provider may still need credentials.
  const cfg = await readConfig();
  if (cfg.provider === slug) await writeConfig({ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL });
  return NextResponse.json({ ok: true });
}
