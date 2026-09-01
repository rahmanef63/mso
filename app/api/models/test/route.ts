import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/auth/require-session";
import { resolveModelRef, hostCredentialStore, selectedCustomConn, readOAuthBundle, writeOAuthBundle } from "@/lib/config/store";
import { resolveModel } from "@/lib/models";
import { safeProviderFetch } from "@/lib/host/ssrf";
import { codexModels, ensureFreshCodex } from "@/lib/ai/oauth/codex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1-token validation of the SELECTED provider's key + endpoint. Session-gated POST.
// Returns { ok:true } or { ok:false, error } (HTTP 200 either way — a failed key is
// a normal UX outcome, not a server error). Mirrors models-rahmanef-com testCredential.
export async function POST() {
  if (!(await requireSession("owner"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const selectedRef = await resolveModelRef();
  if (selectedRef.startsWith("openai-codex/")) {
    const selectedModel = selectedRef.slice("openai-codex/".length);
    try {
      const stored = await readOAuthBundle("openai-codex");
      if (!stored) return NextResponse.json({ ok: false, error: "OpenAI ChatGPT OAuth is not connected" });
      const fresh = await ensureFreshCodex(stored);
      if (fresh !== stored) await writeOAuthBundle("openai-codex", fresh);
      const models = await codexModels(fresh);
      if (!models.includes(selectedModel)) {
        return NextResponse.json({ ok: false, error: `model ${selectedModel} is not available for this ChatGPT account` });
      }
      return NextResponse.json({ ok: true, provider: "openai-codex", model: selectedModel });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message });
    }
  }

  let resolved;
  let customProvider = false;
  try {
    const custom = await selectedCustomConn();
    customProvider = Boolean(custom);
    resolved = await resolveModel(selectedRef, {
      store: hostCredentialStore(),
      baseUrl: custom?.baseUrl,
      protocol: custom?.protocol,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }

  try {
    if (resolved.protocol === "anthropic") {
      const a = new Anthropic({
        apiKey: resolved.apiKey, baseURL: resolved.baseUrl,
        ...(customProvider ? { fetch: safeProviderFetch } : {}),
      });
      await a.messages.create({ model: resolved.model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
    } else {
      const r = await (customProvider ? safeProviderFetch : fetch)(`${resolved.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${resolved.apiKey}` },
        body: JSON.stringify({ model: resolved.model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return NextResponse.json({ ok: false, error: `HTTP ${r.status}${t ? `: ${t.slice(0, 140)}` : ""}` });
      }
    }
    return NextResponse.json({ ok: true, provider: resolved.provider, model: resolved.model });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}
