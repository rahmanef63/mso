"use client";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { McpAuditSection, type McpAuditRow } from "./mcp-audit-section";

export function McpActivity() {
  const [result, setResult] = useState<{ entries?: McpAuditRow[]; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    fetch("/api/v1/sys/audit?actor=mcp%3A&limit=20", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Activity could not be loaded."); return response.json(); })
      .then(data => { if (current) setResult({ entries: data.entries ?? [] }); })
      .catch(() => { if (current) setResult({ error: "Activity could not be loaded. Try again." }); })
      .finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  if (!result) return <p role="status">Loading recent activity…</p>;
  if (result.error) return <div className="space-y-3"><p role="alert">{result.error}</p><Button onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>;
  return <McpAuditSection trail={result.entries ?? []} />;
}
