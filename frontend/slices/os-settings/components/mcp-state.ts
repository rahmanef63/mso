"use client";

import { useCallback, useEffect, useState } from "react";
import type { McpTokenRow } from "./mcp-token-section";
import type { McpToolsetInfo } from "./mcp-toolset-card";

export type McpState = { enabled: boolean; maxScope: string; toolset: McpToolsetInfo; tokens: McpTokenRow[]; origin: string };
export function useMcpState() {
  const [state, setState] = useState<McpState | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let current = true;
    fetch("/api/mcp/tokens", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Owner access is required. Sign in again to manage MCP." : "MCP settings could not be loaded. Check the connection and try again.");
        return response.json() as Promise<McpState>;
      })
      .then(next => { if (current) { setState(next); setError(""); } })
      .catch(reason => { if (current) setError(controller.signal.aborted ? "The request timed out. Try again." : String(reason.message)); })
      .finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  return { state, error, reload };
}
