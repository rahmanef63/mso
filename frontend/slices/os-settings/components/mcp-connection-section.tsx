"use client";

import { useState } from "react";
import { Check, Copy, Plug, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { McpToolsetCard, type McpToolsetInfo } from "./mcp-toolset-card";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <SettingsBlock className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
      <span className="shrink-0 text-[13px] font-medium sm:w-32">{label}</span>
      <div className="min-w-0 flex-1 rounded-lg bg-secondary/60 px-3 py-2">
        <code className="block break-all font-mono text-[11px] leading-relaxed text-secondary-foreground sm:text-xs">{value}</code>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label}`}
        className="size-9 shrink-0 self-end sm:self-auto [@media(pointer:coarse)]:size-11"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </SettingsBlock>
  );
}

export function McpConnectionSection({
  origin,
  maxScope,
  toolset,
}: {
  origin: string;
  maxScope: string;
  toolset: McpToolsetInfo;
}) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <SettingsSection
        icon={<Plug />}
        title="Connection"
        footnote={<>Highest scope this server will mint: <strong>{maxScope}</strong> (<code className="font-mono">OS_MCP_MAX_SCOPE</code>).</>}
      >
        <SettingsBlock className="space-y-1.5 py-4">
          <p className="text-sm font-medium">Connect ChatGPT with User-Defined OAuth</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            In ChatGPT open Settings → Connectors → New App. Use OAuth, leave Client Secret empty, and set token endpoint authentication to none.
          </p>
        </SettingsBlock>
        <CopyRow label="MCP Server URL" value={`${origin}/mcp`} />
        <CopyRow label="Auth URL" value={`${origin}/oauth/authorize`} />
        <CopyRow label="Token URL" value={`${origin}/oauth/token`} />
        <CopyRow label="Resource" value={`${origin}/mcp`} />
        <CopyRow label="Client ID" value="chatgpt-mso" />
        <SettingsBlock className="space-y-1.5 py-4">
          <p className="text-[13px] font-medium">Other MCP clients</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Claude.ai, Cursor and mcp-remote register themselves. Give them <code className="break-all font-mono">{origin}/mcp</code> and nothing else.
          </p>
        </SettingsBlock>
      </SettingsSection>

      <SettingsSection icon={<Wrench />} title="Toolset status" bare>
        <McpToolsetCard info={toolset} />
      </SettingsSection>
    </div>
  );
}
