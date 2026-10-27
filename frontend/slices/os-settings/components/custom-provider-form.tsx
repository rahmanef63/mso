"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/features/appshell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseCustomProviderConfig, parseModelList, toggleModelInList } from "./custom-provider-config";

export type DiscoveredModel = { id: string; name: string };
export type DiscoveryFailure = "invalid-url" | "auth" | "empty";
type Reply = { ok?: boolean; models?: DiscoveredModel[]; error?: string };

// Three actionable failures, never one generic "discovery failed": a malformed
// base URL, a rejected key, and a reachable endpoint with no models need
// different fixes. Exported so the messages are testable and stay distinct.
export const DISCOVERY_MESSAGES: Record<DiscoveryFailure, string> = {
  "invalid-url": "That endpoint URL isn’t usable. Use a full https:// base URL (e.g. https://host/v1) that the server can reach.",
  auth: "That endpoint rejected the API key (401/403). Check the key, then retry Discover.",
  empty: "The endpoint answered but listed no models. Type the ids by hand or paste JSON instead.",
};

export function baseUrlLooksValid(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Map a discovery response to a failure kind, or null when models came back.
 * The route reports endpoint failures as `{ok:false,error}` with HTTP 200, so the
 * status alone is not enough — the body has to be classified too. */
export function classifyDiscovery(status: number, body: Reply): DiscoveryFailure | null {
  const text = String(body.error ?? "");
  if (status === 401 || status === 403 || /HTTP (401|403)/.test(text)) return "auth";
  if (status >= 400) return "invalid-url"; // rejected body: malformed / unsafe URL
  if (body.ok === false) return /no models|invalid JSON/i.test(text) ? "empty" : "invalid-url";
  return Array.isArray(body.models) && body.models.length ? null : "empty";
}

/** The baseURL+key pair a discovery run is keyed by, or null until it is usable.
 * Keyed by the pair so a re-render cannot re-fire it. */
export function discoveryPairKey(baseURL: string, apiKey: string): string | null {
  return baseUrlLooksValid(baseURL) && apiKey.trim() ? `${baseURL.trim()}\n${apiKey.trim()}` : null;
}

/** Claim the pair BEFORE fetching; false means "this pair already ran". */
export function claimDiscovery(fired: Set<string>, pair: string | null): boolean {
  if (!pair || fired.has(pair)) return false;
  fired.add(pair);
  return true;
}

/** Every discovered id into the delimited models field. Connecting a provider
 * normally wants all of them; tapping chips one by one was the reported pain. */
export function modelFieldFromDiscovered(list: DiscoveredModel[]): string {
  return list.map((model) => model.id).join(", ");
}

// Add a custom OpenAI-compatible / Anthropic-Messages provider: fields or pasted
// JSON. "Discover models" asks the endpoint's own list API (POST /api/models/discover,
// SSRF-pinned, key only in the body) and PRE-SELECTS every returned id. It also runs
// itself once per baseURL+key pair — debounced, cancellable; the button re-runs it.
export function CustomProviderForm({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [name, setName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [key, setKey] = useState("");
  const [protocol, setProtocol] = useState("openai");
  const [models, setModels] = useState("");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<DiscoveredModel[]>([]);
  const [scanning, setScanning] = useState(false);
  const [failure, setFailure] = useState<DiscoveryFailure | null>(null);
  const autoFired = useRef<Set<string>>(new Set()); // pairs already auto-run
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (signal: AbortSignal, target: string, apiKey: string, proto: string) => {
    if (!baseUrlLooksValid(target) || !apiKey.trim()) {
      setFailure("invalid-url");
      return;
    }
    setScanning(true);
    setFailure(null);
    try {
      const response = await fetch("/api/models/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseURL: target, apiKey, protocol: proto }),
        signal,
      });
      const body = (await response.json().catch(() => ({}))) as Reply;
      const kind = classifyDiscovery(response.status, body);
      if (kind) {
        setFound([]);
        setFailure(kind);
        return;
      }
      const list = body.models ?? [];
      setFound(list);
      setModels(modelFieldFromDiscovered(list));
      toast(`Discovered ${list.length} model${list.length === 1 ? "" : "s"}, all selected`);
    } catch {
      if (!signal.aborted) setFailure("invalid-url");
    } finally {
      if (!signal.aborted) setScanning(false);
    }
  }, []);

  const start = useCallback((target: string, apiKey: string, proto: string) => {
    abortRef.current?.abort(); // one discovery in flight, cancellable
    const controller = new AbortController();
    abortRef.current = controller;
    void run(controller.signal, target, apiKey, proto);
  }, [run]);

  // Auto-discovery: 700 ms debounce, pair claimed before the fetch, aborted when
  // the pair changes or the form unmounts. Never on every keystroke, never twice.
  useEffect(() => {
    if (mode !== "fields") return;
    const pair = discoveryPairKey(baseURL, key);
    if (!pair || autoFired.current.has(pair)) return;
    const timer = setTimeout(() => {
      if (claimDiscovery(autoFired.current, pair)) start(baseURL.trim(), key.trim(), protocol);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [baseURL, key, mode, protocol, start]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The route re-validates everything (SSRF, slug, key); this only reports it.
  async function submit() {
    setBusy(true);
    try {
      const payload = mode === "json"
        ? parseCustomProviderConfig(json) // throws on bad JSON / missing fields
        : { name, baseURL, apiKey: key, protocol, models: parseModelList(models) };
      const response = await fetch("/api/config", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ customProvider: payload }),
      });
      const body = (await response.json().catch(() => ({}))) as { slug?: string; error?: string };
      if (!response.ok) return void toast(body.error || "Couldn’t add provider", { tone: "error" });
      setName(""); setBaseURL(""); setKey(""); setModels(""); setJson(""); setFound([]); setFailure(null);
      autoFired.current.clear(); // a fresh form starts with a fresh budget
      toast(`Added ${body.slug ?? "provider"}`);
      onAdded();
    } catch (e) {
      toast((e as Error).message || "Invalid config", { tone: "error" });
    } finally { setBusy(false); }
  }

  const selectedIds = parseModelList(models);
  const canSubmit = !busy && (mode === "json" ? !!json.trim() : !!name && !!baseURL && !!key);
  const ghost = "h-auto p-0 text-xs hover:bg-transparent hover:underline [@media(pointer:coarse)]:min-h-[44px]";

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Custom endpoint: OpenAI-compatible or Anthropic Messages</span>
        <Button type="button" variant="ghost" className={`${ghost} text-primary`} onClick={() => setMode(mode === "fields" ? "json" : "fields")}>
          {mode === "fields" ? "paste JSON" : "use fields"}
        </Button>
      </div>
      {mode === "fields" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Input disabled={busy} aria-label="Provider name" placeholder="name (e.g. my-llm)" value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
            <Select value={protocol} onValueChange={setProtocol}>
              <SelectTrigger aria-label="Endpoint protocol" className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI /chat/completions</SelectItem>
                <SelectItem value="anthropic">Anthropic /v1/messages</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input disabled={busy} aria-label="Base URL" placeholder="https://host/v1" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
          <Input disabled={busy} aria-label="API key" type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} />
          <div className="flex items-center gap-2">
            <Input disabled={busy} aria-label="Models" placeholder="models: comma/newline, e.g. minimax-m3, gpt-4o" value={models} onChange={(e) => setModels(e.target.value)} className="flex-1" />
            <Button type="button" variant="outline" size="sm" className="[@media(pointer:coarse)]:min-h-[44px]" disabled={busy || scanning || !baseURL || !key} onClick={() => start(baseURL, key, protocol)}>
              {scanning ? "Discovering…" : "Discover models"}
            </Button>
          </div>
          {failure ? <p role="alert" className="text-xs text-destructive">{DISCOVERY_MESSAGES[failure]}</p> : null}
          {found.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{found.length} found · {selectedIds.length} selected</span>
                <Button type="button" variant="ghost" size="sm" className={`${ghost} text-primary`} onClick={() => setModels(modelFieldFromDiscovered(found))}>Select all</Button>
                <Button type="button" variant="ghost" size="sm" className={ghost} onClick={() => setModels("")}>Clear</Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {found.map((model) => (
                  <button key={model.id} type="button" title={model.name} aria-pressed={selectedIds.includes(model.id)}
                    onClick={() => setModels((prev) => toggleModelInList(prev, model.id))}
                    className={`rounded-md border px-2 py-1 font-mono text-xs [@media(pointer:coarse)]:min-h-[44px] ${selectedIds.includes(model.id) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {model.id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <Textarea disabled={busy} rows={7} className="font-mono text-xs" value={json} aria-label="Custom provider JSON"
          onChange={(e) => setJson(e.target.value)}
          placeholder={'{\n  "name": "ai-hub",\n  "baseURL": "https://host/v1",\n  "apiKey": "sk-…",\n  "protocol": "openai",\n  "models": ["minimax-m3", "gpt-4o"]\n}'} />
      )}
      <div className="flex justify-end">
        <Button size="sm" className="[@media(pointer:coarse)]:min-h-[44px]" disabled={!canSubmit} onClick={submit}>{busy ? "Adding…" : "Add provider"}</Button>
      </div>
    </div>
  );
}
