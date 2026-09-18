"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicProjectMcpServer } from "@/lib/contracts/project-mcp";
export type McpSnapshot = { project: string; revision: string; installationScope: string; servers: PublicProjectMcpServer[] };
export type McpMutation = { server: string; plugin?: "si-coder" | "batonly"; url?: string; user?: string; connection?: string };
async function request(args: object, signal?: AbortSignal) {
  const response = await fetch("/api/v1/project-mcp", { method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "MCP operation failed");
  return data;
}
export function useMcpInstallations(project: string) {
  const [snapshot, setSnapshot] = useState<McpSnapshot | null>(null);
  // Keep target controls locked from the first render until inspection finishes.
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const generation = useRef(0), source = useRef(Symbol("mcp-installations"));
  const reload = useCallback(async (signal?: AbortSignal) => {
    const epoch = ++generation.current;
    setBusy(true); setError("");
    try { const data = await request({ project, action: "inspect" }, signal); if (!signal?.aborted && epoch === generation.current) setSnapshot(data); }
    catch (cause) { if (!signal?.aborted && epoch === generation.current) setError(cause instanceof Error ? cause.message : "MCP inspection failed"); }
    finally { if (epoch === generation.current && !signal?.aborted) setBusy(false); }
  }, [project]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { setSnapshot(null); void reload(controller.signal); }, 0);
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.source !== source.current) void reload(controller.signal); };
    window.addEventListener("mso:extensions-changed", changed);
    return () => { window.clearTimeout(timer); controller.abort(); window.removeEventListener("mso:extensions-changed", changed); };
  }, [reload]);
  async function mutate(action: "upsert" | "delete", input: McpMutation) {
    if (!snapshot || busy) return false;
    setBusy(true); setError("");
    try {
      await request({ project, action, revision: snapshot.revision, ...input });
      await reload(); window.dispatchEvent(new CustomEvent("mso:extensions-changed", { detail: { source: source.current } })); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "MCP operation failed"); return false; }
    finally { setBusy(false); }
  }
  return { snapshot, busy, error, reload, mutate };
}
