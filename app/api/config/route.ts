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
} from "@/lib/config/store";
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
  if (!(await requireSession())) {
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

  // Connected = every provider with a stored key, plus custom + OAuth providers.
  // Custom rows carry baseUrl/protocol/models; OAuth rows just report "signed in".
  const ids = new Set([...Object.keys(keys), ...Object.keys(custom), ...Object.keys(oauth)]);
  const providers = [...ids].sort().map((id) => ({
    id,
    kind: oauth[id] ? "oauth" : isBuiltinProvider(id) ? "builtin" : "custom",
    hasKey: !!keys[id] || !!oauth[id],
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
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: {
    apiKey?: string;
    anthropicApiKey?: string;
    model?: string;
    provider?: string;
    customProvider?: CustomBody;
    tokenSaver?: string;
  };
  try {
    body = await req.json();
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
    if (isBuiltinProvider(slug)) {
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
    // Select the new provider (+ its first model) so the assistant uses it now.
    await writeConfig({ provider: slug, ...(models[0] ? { model: models[0] } : {}) });
    return NextResponse.json({ ok: true, slug });
  }

  // ── Set a built-in provider / model / key ──────────────────────────────────
  const provider = (body.provider || DEFAULT_PROVIDER).trim();
  const patch: { model?: string; provider?: string } = { provider };
  if (typeof body.model === "string" && body.model.trim()) patch.model = body.model.trim();
  await writeConfig(patch);

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
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const slug = new URL(req.url).searchParams.get("provider")?.trim();
  if (!slug) return NextResponse.json({ error: "provider required" }, { status: 400 });
  await hostCredentialStore().deleteKey(undefined, slug);
  await removeCustomProvider(slug);
  await removeOAuthBundle(slug);
  // If the deleted provider was selected, fall back to the default so the
  // assistant never points at a now-keyless provider.
  const cfg = await readConfig();
  if (cfg.provider === slug) await writeConfig({ provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL });
  return NextResponse.json({ ok: true });
}
