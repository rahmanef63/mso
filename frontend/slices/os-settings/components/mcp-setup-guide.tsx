"use client";
import { Button } from "@/components/ui/button";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { ArrowLeft, PlugZap } from "lucide-react";
import { useState } from "react";
import { MCP_CLIENTS, type McpClientId } from "./mcp-client-core";
import { McpClientPicker } from "./mcp-client-picker";
import { McpClientSetup } from "./mcp-client-setup";
import { mcpClientSteps } from "./mcp-client-steps";

export function McpSetupGuide({ origin, maxScope }: { origin: string; maxScope: string }) {
  const [client, setClient] = useState<McpClientId | null>(null);
  if (!client) return <McpClientPicker onSelect={setClient} />;
  const selected = MCP_CLIENTS.find(item => item.id === client)!;
  return <SettingsSection icon={<PlugZap />} title={`Connect ${selected.label}`}>
    <Button variant="ghost" className="min-h-11" onClick={() => setClient(null)}><ArrowLeft className="size-4" /> Choose another app</Button>
    <SettingsBlock className="space-y-4 py-4"><McpClientSetup client={client} selected={selected} steps={mcpClientSteps(client, origin)} /></SettingsBlock>
    <p className="text-sm leading-relaxed text-muted-foreground">Choose the access your app needs when approving the connection: <strong>read</strong> inspects data, <strong>write</strong> changes data, and <strong>exec</strong> runs host commands. This server allows up to <strong>{maxScope}</strong>.</p>
  </SettingsSection>;
}
