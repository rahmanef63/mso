"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InfrastructureFeatureId } from "../index";
export type ProviderField = { key: string; label: string; secret: boolean; required: boolean; placeholder?: string; description: string };
export type Provider = { id: string; title: string; description: string; configured: boolean; missing: string[]; values: Record<string, string>; fields: ProviderField[] };
type Doctor = { id: string; ok: boolean | null; detail: string };
type Item = { id: string; name: string };
async function json<T>(url: string, signal: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}
export function useProvider(provider: InfrastructureFeatureId) {
  const [meta, setMeta] = useState<Provider | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null), operation = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const data = await json<{ providers: Provider[] }>("/api/v1/infra/providers", controller.signal);
      if (controller.signal.aborted) return;
      const row = data.providers.find(entry => entry.id === provider) ?? null;
      if (!row) throw new Error("Provider configuration is unavailable.");
      setMeta(row);
      setForm(current => Object.fromEntries(row.fields.map(field => [field.key, current[field.key] ?? (field.secret ? "" : row.values[field.key] ?? "")])));
      const next = !row.configured ? [] : provider === "dokploy"
        ? (await json<{ projects: { projectId: string; name: string }[] }>("/api/v1/infra/dokploy/projects", controller.signal)).projects.map(item => ({ id: item.projectId, name: item.name }))
        : (await json<{ zones: Item[] }>("/api/v1/infra/cloudflare/zones", controller.signal)).zones;
      if (controller.signal.aborted) return;
      setItems(next); setLoaded(true);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Provider refresh failed.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [provider]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setMeta(null); setForm({}); setDoctor(null); setItems([]); setLoaded(false); void refresh(); }, 0);
    return () => { clearTimeout(timer); request.current?.abort(); operation.current?.abort(); operation.current = null; };
  }, [refresh]);
  const mutate = async (saveValues: boolean) => {
    if (!meta || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError("");
    try {
      if (saveValues) {
        const values = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim()));
        await json("/api/v1/infra/providers", controller.signal, { method: "POST", body: JSON.stringify({ id: provider, values }) });
        if (controller.signal.aborted) return;
        setForm(current => ({ ...current, ...Object.fromEntries(meta.fields.filter(field => field.secret).map(field => [field.key, ""])) }));
      }
      const result = await json<{ results: Doctor[] }>("/api/v1/infra/providers/doctor", controller.signal, { method: "POST", body: JSON.stringify({ id: provider }) });
      if (controller.signal.aborted) return;
      setDoctor(result.results[0] ?? null); await refresh();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Provider action failed.");
    } finally {
      if (operation.current === controller) { operation.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  };
  return { meta, form, setForm, doctor, items, loading, loaded, busy, error, refresh, save: () => mutate(true), verify: () => mutate(false) };
}
