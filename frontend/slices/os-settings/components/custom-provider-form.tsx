"use client";

import { useState } from "react";
import { toast } from "@/features/appshell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseCustomProviderConfig, parseModelList } from "./custom-provider-config";

// Add a custom OpenAI-compatible / Anthropic-Messages provider. Two input modes:
//  • fields — name / protocol / baseURL / key (+ optional comma/newline models)
//  • JSON   — paste {name, baseURL, apiKey, protocol, models[]} whole
// POSTs { customProvider } to /api/config (SSRF-checked, slug-reserved server-side);
// the added provider is selected immediately. onAdded refreshes the parent.
export function CustomProviderForm({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [name, setName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [key, setKey] = useState("");
  const [protocol, setProtocol] = useState("openai");
  const [models, setModels] = useState("");
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload =
        mode === "json"
          ? parseCustomProviderConfig(json) // throws on bad JSON / missing fields
          : { name, baseURL, apiKey: key, protocol, models: parseModelList(models) };
      const r = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customProvider: payload }),
      });
      const d = (await r.json().catch(() => ({}))) as { slug?: string; error?: string };
      if (!r.ok) {
        toast(d.error || "Couldn’t add provider", { tone: "error" });
        return;
      }
      setName(""); setBaseURL(""); setKey(""); setModels(""); setJson("");
      toast(`Added ${d.slug ?? "provider"}`);
      onAdded();
    } catch (e) {
      toast((e as Error).message || "Invalid config", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && (mode === "json" ? !!json.trim() : !!name && !!baseURL && !!key);

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Custom endpoint — OpenAI-compatible or Anthropic Messages</span>
        <Button
          type="button"
          variant="ghost"
          className="h-auto p-0 text-xs text-primary hover:bg-transparent hover:underline [@media(pointer:coarse)]:min-h-[44px]"
          onClick={() => setMode(mode === "fields" ? "json" : "fields")}
        >
          {mode === "fields" ? "paste JSON" : "use fields"}
        </Button>
      </div>

      {mode === "fields" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Input disabled={busy} placeholder="name (e.g. my-llm)" value={name} onChange={(e) => setName(e.target.value)} className="w-40" />
            <Select value={protocol} onValueChange={setProtocol}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI /chat/completions</SelectItem>
                <SelectItem value="anthropic">Anthropic /v1/messages</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input disabled={busy} placeholder="https://host/v1" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
          <Input disabled={busy} type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} />
          <Input disabled={busy} placeholder="models (optional) — comma/newline, e.g. minimax-m3, gpt-4o" value={models} onChange={(e) => setModels(e.target.value)} />
        </div>
      ) : (
        <Textarea
          disabled={busy}
          rows={7}
          className="font-mono text-xs"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder={'{\n  "name": "ai-hub",\n  "baseURL": "https://host/v1",\n  "apiKey": "sk-…",\n  "protocol": "openai",\n  "models": ["minimax-m3", "gpt-4o"]\n}'}
        />
      )}

      <div className="flex justify-end">
        <Button size="sm" className="[@media(pointer:coarse)]:min-h-[44px]" disabled={!canSubmit} onClick={submit}>{busy ? "Adding…" : "Add provider"}</Button>
      </div>
    </div>
  );
}
