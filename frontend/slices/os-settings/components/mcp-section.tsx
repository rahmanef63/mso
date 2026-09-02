"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { toast } from "@/features/appshell";
import { IS_DEMO } from "@/lib/demo";
import { McpAuditSection, type McpAuditRow } from "./mcp-audit-section";
import { McpConnectionSection } from "./mcp-connection-section";
import { McpTokenSection, type McpTokenRow } from "./mcp-token-section";
import type { McpToolsetInfo } from "./mcp-toolset-card";
import { McpCopyField } from "./mcp-copy-field";

type McpState = {
  enabled: boolean;
  maxScope: string;
  toolset: McpToolsetInfo;
  tokens: McpTokenRow[];
  origin: string;
};

export function McpSection() {
  const [state, setState] = useState<McpState | null>(null);
  const [trail, setTrail] = useState<McpAuditRow[]>([]);

  const load = useCallback(() => {
    if (IS_DEMO) return;
    fetch("/api/mcp/tokens", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((next: McpState) => {
        setState(next);
      })
      .catch(() => toast("Couldn't load MCP tokens", { tone: "error" }));

    fetch("/api/v1/sys/audit?actor=mcp%3A&limit=20", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { entries: [] }))
      .then((data: { entries?: McpAuditRow[] }) => setTrail(data.entries ?? []))
      .catch(() => setTrail([]));
  }, []);

  useEffect(load, [load]);

  async function revoke(id: string, what: string) {
    const response = await fetch(`/api/mcp/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      toast(`Couldn't revoke ${what}`, { tone: "error" });
      return;
    }
    toast(`Revoked ${what}. Any client using it is cut off now.`);
    load();
  }

  if (IS_DEMO) {
    return (
      <SettingsSection icon={<Plug />} title="MCP connection">
        <SettingsBlock className="space-y-1.5 py-4">
          <p className="text-sm font-medium">MCP is unavailable in demo mode</p>
          <p className="text-xs leading-relaxed text-muted-foreground">Connect to a live MSO host to configure OAuth, inspect tokens, and review MCP activity.</p>
        </SettingsBlock>
      </SettingsSection>
    );
  }

  if (!state) {
    return (
      <SettingsSection icon={<Plug />} title="MCP connection">
        <SettingsBlock>
          <div className="space-y-2" aria-live="polite">
            <div className="h-4 w-40 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-secondary/70" />
          </div>
        </SettingsBlock>
      </SettingsSection>
    );
  }

  if (!state.enabled) {
    return (
      <SettingsSection
        icon={<Plug />}
        title="MCP connection"
        footnote="When disabled, the MCP endpoint and OAuth discovery documents return 404, so no unauthenticated MCP surface remains exposed."
      >
        <SettingsBlock className="space-y-3 py-4">
          <div>
            <p className="text-sm font-medium">Turn on MCP first</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Add these values to <code className="font-mono">.env.local</code>. Start with read access; raise the ceiling only when you actually need writes or host execution.
            </p>
          </div>
          <McpCopyField label="Recommended starting config" value={"OS_MCP_ENABLED=1\nOS_MCP_MAX_SCOPE=read"} multiline />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Apply it with <code className="font-mono">mso update --rebuild</code>. On WSL without systemd, MSO still rebuilds locally; reopen with <code className="font-mono">mso web</code> afterward.
          </p>
        </SettingsBlock>
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <McpConnectionSection origin={state.origin} maxScope={state.maxScope} toolset={state.toolset} />
      <McpTokenSection tokens={state.tokens} onRevoke={revoke} />
      <McpAuditSection trail={trail} />
    </div>
  );
}
