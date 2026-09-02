"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { toast } from "@/features/appshell";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsRow, SettingsBlock } from "@/features/shell-settings";
import { DEFAULT_MODELS } from "@/lib/models/defaults";
import { type ConnectedProvider } from "./provider-list";
import { ProviderManage } from "./provider-manage";
import { ModelCatalog } from "./model-catalog";

type Cfg = { hasApiKey: boolean; apiKeyMasked: string; model: string; provider?: string; providers?: ConnectedProvider[] };
type CatModel = { ref: string; provider: string; id: string };

// Curated built-in BYOK providers (the @rahmanef/models registry wires ~35; these
// are the common ones with nice labels/hints). Any other endpoint → "Add custom
// provider" below. Non-Anthropic providers stream through the openai-protocol adapter.
const BUILTINS: { slug: string; label: string; keyHint: string }[] = [
  { slug: "anthropic", label: "Anthropic (Claude)", keyHint: "sk-ant-…" },
  { slug: "openai", label: "OpenAI (GPT)", keyHint: "sk-…" },
  { slug: "openrouter", label: "OpenRouter", keyHint: "sk-or-…" },
  { slug: "google", label: "Google (Gemini)", keyHint: "AIza…" },
  { slug: "groq", label: "Groq", keyHint: "gsk_…" },
  { slug: "xai", label: "xAI (Grok)", keyHint: "xai-…" },
  { slug: "deepseek", label: "DeepSeek", keyHint: "sk-…" },
  { slug: "mistral", label: "Mistral", keyHint: "…" },
];

// Sensible default model per built-in so switching provider never leaves a stale
// cross-provider model id (e.g. anthropic's default paired with openai).
// BYOK config for the Alfa assistant. Raw keys are write-only from here — GET
// /api/config returns only masked previews. Empty key on save keeps the stored one.
export function AiSection() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [catalog, setCatalog] = useState<CatModel[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchCfg = useCallback(async (): Promise<Cfg | null> => {
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      return r.ok ? ((await r.json()) as Cfg) : null;
    } catch {
      return null;
    }
  }, []);

  const applyCfg = useCallback((c: Cfg) => {
    setCfg(c);
    setProvider(c.provider || "anthropic");
    setModel(c.model || DEFAULT_MODELS[c.provider || "anthropic"] || "");
  }, []);
  const load = useCallback(async () => {
    const c = await fetchCfg();
    if (c) applyCfg(c);
  }, [fetchCfg, applyCfg]);

  useEffect(() => {
    let alive = true;
    fetchCfg().then((c) => alive && c && applyCfg(c));
    return () => {
      alive = false;
    };
  }, [fetchCfg, applyCfg]);

  // Model suggestions for the picked provider (models.dev catalog); free-text field
  // so it always works offline.
  useEffect(() => {
    let alive = true;
    fetch(`/api/models?provider=${encodeURIComponent(provider)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => {
        if (!alive) return;
        const rows = (d.models ?? []) as CatModel[];
        setCatalog(rows);
        // Providers with no static default (OAuth ones, whose ids are account-scoped)
        // would otherwise leave the field blank. Take the account's first real model.
        setModel((current) => current || rows[0]?.id || "");
      })
      .catch(() => alive && setCatalog([]));
    return () => {
      alive = false;
    };
  }, [provider]);

  const extraProviders = (cfg?.providers ?? []).filter((p) => p.kind === "custom" || p.kind === "oauth");
  const selectedMeta = (cfg?.providers ?? []).find((p) => p.id === provider);
  const isCustom = selectedMeta?.kind === "custom";
  const isOAuth = selectedMeta?.kind === "oauth";
  const prov = BUILTINS.find((p) => p.slug === provider);
  const onSavedProvider = provider === cfg?.provider;
  const customModels = selectedMeta?.models ?? [];

  async function onSave() {
    setBusy(true);
    try {
      const r = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          ...(key.trim() ? { apiKey: key.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
        }),
      });
      if (!r.ok) {
        toast(r.status === 401 ? "Session expired — sign in again" : "Couldn’t save AI config", { tone: "error" });
        return;
      }
      setKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      void load();
    } catch {
      toast("Couldn’t reach the server", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setBusy(true);
    setTest(null);
    try {
      const r = await fetch("/api/models/test", { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setTest(d.ok ? { ok: true, msg: "Connected" } : { ok: false, msg: d.error || "Failed" });
    } catch {
      setTest({ ok: false, msg: "Couldn’t reach the server" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      icon={<Sparkles />}
      title="AI (Alfa)"
      footnote={
        <>
          Bring your own key (stored server-side, never shown again). Built-ins use a pasted key — there
          is no “sign in with OpenAI” for the platform API. Add any OpenAI-compatible or Anthropic-Messages
          endpoint below. If the key is empty, the matching server env var (e.g. <code>ANTHROPIC_API_KEY</code>) is used.
        </>
      }
    >
      <SettingsRow label="Provider">
        <Select
          value={provider}
          onValueChange={(v) => {
            setProvider(v);
            // OAuth providers have no static default worth having — their model ids
            // are account-scoped. The catalog effect below refills `model` from the
            // account's own first entry; clearing here avoids briefly showing a
            // literal the backend would reject.
            setModel(DEFAULT_MODELS[v] ?? "");
            setTest(null); // drop any stale connection-test result for the old provider
          }}
        >
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BUILTINS.map((p) => (
              <SelectItem key={p.slug} value={p.slug}>{p.label}</SelectItem>
            ))}
            {extraProviders.length > 0 && (
              <SelectGroup>
                <SelectLabel>Connected</SelectLabel>
                {extraProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.id}{p.kind === "oauth" ? " (OAuth)" : ""}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </SettingsRow>
      {isOAuth ? (
        <SettingsRow label="Auth">
          <span className="text-sm text-muted-foreground">Signed in via OAuth — no key needed</span>
        </SettingsRow>
      ) : (
        <SettingsRow label={`${isCustom ? provider : prov?.label ?? "Provider"} key`}>
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={onSavedProvider && cfg?.hasApiKey ? cfg.apiKeyMasked : (prov?.keyHint ?? "API key")}
            className="sm:w-56"
          />
        </SettingsRow>
      )}
      <SettingsRow label="Model">
        <div className="flex items-center gap-2">
          <Input
            list="ai-model-suggestions"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={(onSavedProvider && cfg?.model) || DEFAULT_MODELS[provider] || "model id"}
            className="sm:w-56"
          />
          <ModelCatalog provider={provider} value={model} onPick={setModel} />
        </div>
        <datalist id="ai-model-suggestions">
          {[...new Set([...customModels, ...catalog.map((m) => m.id)])].map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      </SettingsRow>
      <SettingsBlock className="flex items-center justify-end gap-2">
        {test && (
          <span className={`text-xs ${test.ok ? "text-emerald-500" : "text-destructive"}`}>
            {test.ok ? "✓ " : "✕ "}
            {test.msg}
          </span>
        )}
        {!isOAuth && (
          <Button size="sm" variant="outline" className="[@media(pointer:coarse)]:min-h-[44px]" onClick={onTest} disabled={cfg === null || busy}>
            Test
          </Button>
        )}
        <Button size="sm" className="[@media(pointer:coarse)]:min-h-[44px]" onClick={onSave} disabled={cfg === null || busy}>
          {saved ? <Check className="size-3.5" /> : null}
          {saved ? "Saved" : busy ? "Saving…" : "Save"}
        </Button>
      </SettingsBlock>

      <ProviderManage providers={cfg?.providers ?? []} selected={provider} reload={load} />
    </SettingsSection>
  );
}
