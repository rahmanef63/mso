"use client";
import { useEffect, useState } from "react";
export function useSessionMonitor<T>(query: string) {
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>();
  useEffect(() => {
    let live = true;
    let current: AbortController | undefined;
    const key = query;
    async function load() {
      current?.abort();
      const controller = new AbortController(); current = controller;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let preserve = true;
      try {
        const response = await fetch("/api/v1/agent-sessions?view=monitor&" + query, { cache: "no-store", signal: controller.signal });
        if (!response.ok) { preserve = response.status >= 500; throw new Error(response.status === 403 ? "Owner access is required. Sign in again." : response.status === 404 ? "This session is no longer available." : "Sessions could not be loaded. Try again."); }
        const data = await response.json() as T;
        if (live && current === controller) setResult({ key, data });
      } catch (error) {
        if (live && current === controller) setResult(previous => ({ key, ...(previous?.key === key && preserve ? { data: previous.data } : {}), error: error instanceof Error && error.name !== "AbortError" ? error.message : "Session request timed out. Try again." }));
      } finally { clearTimeout(timeout); }
    }
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => { live = false; current?.abort(); clearInterval(timer); };
  }, [query, attempt]);
  return { ...(result?.key === query ? result : {}), reload: () => retry(value => value + 1) };
}
