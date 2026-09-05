"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { cn } from "@/lib/utils";
import { McpClientSetup } from "./mcp-client-setup";
import { MCP_CLIENTS, isRemoteMcpOrigin, mcpEndpoints, type McpClientId, type McpProbeResult } from "./mcp-client-core";
import { probeMcpConnection } from "./mcp-probe";
import { mcpClientSteps } from "./mcp-client-steps";
import { McpConnectionMode } from "./mcp-connection-mode";
import { McpCopyField } from "./mcp-copy-field";
import { McpProbeStatus, type ProbeState } from "./mcp-probe-status";

function sameOriginFetch(input: RequestInfo | URL, init?: RequestInit) {
  const target = new URL(String(input));
  return fetch(`${target.pathname}${target.search}`, init);
}

export function McpSetupGuide({ origin, maxScope }: { origin: string; maxScope: string }) {
  const [client, setClient] = useState<McpClientId>("chatgpt");
  const [probeState, setProbeState] = useState<ProbeState>("checking");
  const [probeResult, setProbeResult] = useState<McpProbeResult | null>(null);
  const endpoints = useMemo(() => mcpEndpoints(origin), [origin]);
  const steps = useMemo(() => mcpClientSteps(client, origin), [client, origin]);
  const selected = MCP_CLIENTS.find((item) => item.id === client) ?? MCP_CLIENTS[0];

  const applyProbe = useCallback((result: McpProbeResult | null) => {
    setProbeResult(result);
    setProbeState(result?.ready ? "ready" : "error");
  }, []);

  const testConnection = useCallback(async () => {
    setProbeState("checking");
    setProbeResult(null);
    applyProbe(await probeMcpConnection(origin, sameOriginFetch).catch(() => null));
  }, [applyProbe, origin]);

  useEffect(() => {
    let current = true;
    void probeMcpConnection(origin, sameOriginFetch).then((result) => { if (current) applyProbe(result); }).catch(() => { if (current) applyProbe(null); });
    return () => { current = false; };
  }, [applyProbe, origin]);

  return (
    <SettingsSection
      icon={<PlugZap />}
      title="Connect an AI client"
      footnote={<>MSO uses remote Streamable HTTP + OAuth/PKCE. The server ceiling is <strong>{maxScope}</strong>; each authorization can choose a lower scope.</>}
    >
      <SettingsBlock className="space-y-3 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><Bot className="size-4 shrink-0" /><p className="text-sm font-medium">Connect MSO to ChatGPT, coding agents, and MCP-capable editors</p></div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">The client receives only the scope you approve. MSO keeps host boundaries, revocation, rate limits, and audit server-side.</p>
          </div>
          <Button type="button" variant="secondary" size="sm" className="min-h-9 shrink-0 [@media(pointer:coarse)]:min-h-[44px]" onClick={() => void testConnection()}>
            <RefreshCw className={cn("mr-1.5 size-3.5", probeState === "checking" && "animate-spin")} />Test connection
          </Button>
        </div>
        <McpProbeStatus state={probeState} result={probeResult} endpoint={endpoints.mcp} />
      </SettingsBlock>

      <SettingsBlock className="py-4"><McpConnectionMode endpoints={endpoints} remote={isRemoteMcpOrigin(origin)} /></SettingsBlock>

      <SettingsBlock className="space-y-4 py-4">
        <McpClientSetup client={client} onClientChange={setClient} selected={selected} steps={steps} />
      </SettingsBlock>

      <SettingsBlock className="space-y-3 py-4">
        <details className="group rounded-lg border border-border/70 bg-secondary/25 px-3 py-2.5">
          <summary className="cursor-pointer select-none text-xs font-medium">Advanced OAuth settings</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <McpCopyField label="MCP Server URL / Resource" value={endpoints.mcp} />
            <McpCopyField label="Authorization URL" value={endpoints.authorize} />
            <McpCopyField label="Token URL" value={endpoints.token} />
            <McpCopyField label="Dynamic registration" value={endpoints.register} />
            <McpCopyField label="Protected-resource metadata" value={endpoints.protectedResource} />
            <McpCopyField label="Authorization-server metadata" value={endpoints.authorizationServer} />
            <McpCopyField label="Public Client ID (manual fallback)" value="chatgpt-mso" />
            <McpCopyField label="Authentication" value="OAuth · authorization_code · PKCE S256" />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Client secret: none · token endpoint auth: none · access-token TTL: 90 days · refresh token: not issued · reconnect after expiry/revocation.</p>
        </details>
        <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <div className="text-xs leading-relaxed">
            <p className="font-medium">Choose the lowest authority that works</p>
            <p className="mt-0.5 text-muted-foreground"><strong>read</strong> inspects data, <strong>write</strong> can change files/apps, and <strong>exec</strong> can execute host commands as the MSO service user. Treat exec like remote shell access.</p>
          </div>
        </div>
      </SettingsBlock>
    </SettingsSection>
  );
}
