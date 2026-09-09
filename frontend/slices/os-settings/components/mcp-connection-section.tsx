"use client";

import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { isRemoteMcpOrigin, mcpEndpoints, type McpProbeResult } from "./mcp-client-core";
import { McpConnectionMode } from "./mcp-connection-mode";
import { McpCopyField } from "./mcp-copy-field";
import { probeMcpConnection } from "./mcp-probe";
import { McpProbeStatus } from "./mcp-probe-status";

function sameOriginFetch(input: RequestInfo | URL, init?: RequestInit) {
  const target = new URL(String(input));
  return fetch(`${target.pathname}${target.search}`, init);
}
export function McpConnectionSection({ origin }: { origin: string }) {
  const [result, setResult] = useState<McpProbeResult | null>(null);
  const [checking, setChecking] = useState(true);
  const endpoints = mcpEndpoints(origin);
  const apply = useCallback((next: McpProbeResult | null) => { setResult(next); setChecking(false); }, []);
  useEffect(() => {
    let current = true;
    probeMcpConnection(origin, sameOriginFetch).then(next => { if (current) apply(next); }).catch(() => { if (current) apply(null); });
    return () => { current = false; };
  }, [origin, apply]);
  async function check() { setChecking(true); apply(await probeMcpConnection(origin, sameOriginFetch).catch(() => null)); }
  return <div className="space-y-4">
    <SettingsBlock className="space-y-3 py-4">
      <McpProbeStatus state={checking ? "checking" : result?.ready ? "ready" : "error"} result={result} endpoint={endpoints.mcp} />
      <Button variant="secondary" disabled={checking} onClick={() => void check()} className="min-h-11"><RefreshCw className="size-4" />{checking ? "Checking…" : "Check connection"}</Button>
    </SettingsBlock>
    <SettingsBlock className="py-4"><McpConnectionMode endpoints={endpoints} remote={isRemoteMcpOrigin(origin)} /></SettingsBlock>
    <SettingsBlock className="py-4">
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Manual OAuth configuration</summary>
        <p className="mb-3 text-sm text-muted-foreground">Only needed if your app asks for individual OAuth endpoints.</p>
        <div className="grid gap-3 @min-[520px]:grid-cols-2">
          <McpCopyField label="MCP server URL" value={endpoints.mcp} />
          <McpCopyField label="Authorization URL" value={endpoints.authorize} />
          <McpCopyField label="Token URL" value={endpoints.token} />
          <McpCopyField label="Dynamic registration" value={endpoints.register} />
          <McpCopyField label="Protected-resource metadata" value={endpoints.protectedResource} />
          <McpCopyField label="Authorization-server metadata" value={endpoints.authorizationServer} />
          <McpCopyField label="Public client ID (manual fallback)" value="chatgpt-mso" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">OAuth authorization code with PKCE S256. No client secret. OAuth access tokens last one hour and renew through rotating refresh tokens, which expire after 90 days. Reconnect if renewal fails or access is revoked.</p>
      </details>
    </SettingsBlock>
  </div>;
}
