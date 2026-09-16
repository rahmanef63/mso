"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { toast } from "@/features/appshell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsRow, SettingsBlock } from "@/features/shell-settings";
import { DEFAULT_MODELS } from "@/lib/models/defaults";
import { type ConnectedProvider } from "./provider-list";
import { ProviderManage } from "./provider-manage";
import { ModelCatalog } from "./model-catalog";
import { AiProviderSelect } from "./ai-provider-select";
import {
  FALLBACK_PROVIDER_OPTIONS,
  suggestedProviderModel,
  type ProviderSummary,
} from "./ai-provider-options";

type Cfg = { hasApiKey: boolean; apiKeyMasked: string; model: string; provider?: string; providers?: ConnectedProvider[] };
type CatModel = { ref: string; provider: string; id: string; free?: boolean; agentReady?: boolean };

// Presentation hints only. Provider availability itself comes from /api/models/providers.
const KEY_HINTS: Record<string, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  openrouter: "sk-or-…",
  google: "AIza…",
  groq: "gsk_…",
  xai: "xai-…",
};

export function AiSection() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [providerOptions, setProviderOptions] = useState<ProviderSummary[]>(FALLBACK_PROVIDER_OPTIONS);
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
    fetch("/api/models/providers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((body) => {
        if (!alive) return;
        const rows = (body.providers ?? []) as ProviderSummary[];
        if (rows.length) setProviderOptions(rows);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [fetchCfg, applyCfg]);

  // Model suggestions use the same endpoint as CLI. Explicit-free, agent-ready
  // rows are presentation-sorted first; this does not change the saved provider/model.
  useEffect(() => {
    let alive = true;
    fetch(`/api/models?provider=${encodeURIComponent(provider)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => {
        if (!alive) return;
        const rows = ((d.models ?? []) as CatModel[]).sort((a, b) =>
          Number(!!b.free && !!b.agentReady) - Number(!!a.free && !!a.agentReady)
            || Number(!!b.free) - Number(!!a.free)
            || a.id.localeCompare(b.id),
        );
        setCatalog(rows);
        setModel((current) => current || rows[0]?.id || "");
      })
      .catch(() => alive && setCatalog([]));
    return () => {
      alive = false;
    };
  }, [provider]);

  const liveIds = new Set(providerOptions.map((row) => row.id));
  const extraProviders = (cfg?.providers ?? []).filter((p) => !liveIds.has(p.id));
  const selectedMeta = (cfg?.providers ?? []).find((p) => p.id === provider);
  const selectedProvider = providerOptions.find((p) => p.id === provider);
  const isCustom = selectedMeta?.kind === "custom";
  const isOAuth = selectedMeta?.kind === "oauth";
  const onSavedProvider = provider === cfg?.provider;
  const customModels = selectedMeta?.models ?? [];
  const providerLabel = selectedProvider?.name || provider;

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
          Provider/model availability is discovered dynamically while runtime endpoints remain pinned by MSO. Keys are stored server-side and never shown again.
          Free means the live model catalog explicitly reports $0 input and $0 output token cost; an account/API key and provider rate limits may still apply.
        </>
      }
    >
      <SettingsRow label="Provider">
        <AiProviderSelect
          value={provider}
          options={providerOptions}
          connectedExtras={extraProviders}
          onChange={(v) => {
            setProvider(v);
            const connected = (cfg?.providers ?? []).find((entry) => entry.id === v);
            const fallback = DEFAULT_MODELS[v] || connected?.models?.[0] || "";
            setModel(suggestedProviderModel(providerOptions, v, fallback));
            setTest(null);
          }}
        />
      </SettingsRow>
      {isOAuth ? (
        <SettingsRow label="Auth">
          <span className="text-sm text-muted-foreground">Signed in via OAuth — no key needed</span>
        </SettingsRow>
      ) : (
        <SettingsRow label={`${isCustom ? provider : providerLabel} key`}>
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={onSavedProvider && cfg?.hasApiKey ? cfg.apiKeyMasked : (KEY_HINTS[provider] ?? "API key")}
            className="sm:w-64"
          />
        </SettingsRow>
      )}
      <SettingsRow label="Model">
        <div className="flex items-center gap-2">
          <Input
            list="ai-model-suggestions"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={(onSavedProvider && cfg?.model) || DEFAULT_MODELS[provider] || selectedProvider?.recommendedFreeModel || "model id"}
            className="sm:w-64"
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
