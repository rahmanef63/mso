"use client";

import { useState } from "react";
import { CloudCog, Globe2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { McpCopyField } from "./mcp-copy-field";
import type { McpEndpointSet } from "./mcp-client-core";

type ConnectionMode = "server" | "tunnel";

export function McpConnectionMode({ endpoints, remote }: { endpoints: McpEndpointSet; remote: boolean }) {
  const [mode, setMode] = useState<ConnectionMode>("server");
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium">Connection</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Use the direct HTTPS URL when this MSO host is reachable; use a tunnel for private or developer-machine deployments.</p>
        </div>
        <Globe2 className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <Tabs>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger active={mode === "server"} onClick={() => setMode("server")} className="min-h-9 flex-1 sm:flex-none [@media(pointer:coarse)]:min-h-[44px]">Server URL</TabsTrigger>
          <TabsTrigger active={mode === "tunnel"} onClick={() => setMode("tunnel")} className="min-h-9 flex-1 sm:flex-none [@media(pointer:coarse)]:min-h-[44px]">Tunnel</TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === "server" ? (
        <div className="space-y-3">
          <McpCopyField label="MCP Server URL · Streamable HTTP" value={endpoints.mcp} />
          <div className={cn("rounded-lg border px-3 py-2.5 text-xs leading-relaxed", remote ? "border-success/30 bg-success/10" : "border-warning/30 bg-warning/10")}>
            {remote ? (
              <><strong>Remote HTTPS origin detected.</strong> Cloud clients can use this URL directly, subject to your reverse proxy/firewall and workspace policy.</>
            ) : (
              <><strong>Local-only origin detected.</strong> A cloud client such as ChatGPT cannot connect directly to {endpoints.origin}. Switch to Tunnel for the supported options.</>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-secondary/25 p-3">
            <div className="flex items-center gap-2"><CloudCog className="size-4" /><p className="text-xs font-medium">MSO Gateway</p></div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">Keep local/WSL MSO on loopback and create an outbound HTTPS gateway. A named tunnel/custom domain is the stable production choice.</p>
            <div className="mt-3 space-y-2">
              <McpCopyField label="Temporary gateway" value={'mso gateway start\nmso gateway url'} multiline />
              <McpCopyField label="Stable origin" value={`mso gateway domain set ${remote ? endpoints.origin : "https://mso.example.com"}`} />
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-secondary/25 p-3">
            <div className="flex items-center gap-2"><Globe2 className="size-4" /><p className="text-xs font-medium">Custom domain / reverse proxy</p></div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">For a stable URL, route an HTTPS hostname to the loopback MSO runtime through your trusted tunnel or reverse proxy, then set that same origin in MSO.</p>
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">Keep the raw Next listener loopback-only. OAuth discovery, redirect validation, cookies, and MCP resource metadata must agree on one public origin.</p>
          </div>

        </div>
      )}
    </div>
  );
}
