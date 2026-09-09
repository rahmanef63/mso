"use client";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth";
import { SettingsBlock, SettingsSection } from "@/features/shell-settings";
import { IS_DEMO } from "@/lib/demo";
import { Lock, Plug } from "lucide-react";
import { useRef, useState } from "react";
import { McpActivity } from "./mcp-activity";
import { McpConnectionSection } from "./mcp-connection-section";
import { McpCopyField } from "./mcp-copy-field";
import { McpNavigation, type McpPage } from "./mcp-navigation";
import { McpSetupGuide } from "./mcp-setup-guide";
import { useMcpState } from "./mcp-state";
import { McpTokenSection } from "./mcp-token-section";
import { McpToolsetCard } from "./mcp-toolset-card";

export function McpSection() {
  const { status, role } = useSession();
  if (status === "loading") return <p role="status" className="text-sm">Checking access…</p>;
  if (IS_DEMO || status !== "in" || role !== "owner") return (
    <SettingsSection icon={<Lock />} title="Connect your AI apps to MSO">
      <SettingsBlock className="space-y-3 py-4">
        <p className="text-sm leading-relaxed">MCP lets apps such as ChatGPT and Cursor use this server with the permissions you approve.</p>
        <p className="text-sm text-muted-foreground">{IS_DEMO ? "MCP configuration is unavailable in this demo." : status === "in" ? "An Owner device is required to manage these connections." : "Sign in as Owner to connect an app, review its access, or check recent activity."}</p>
        {!IS_DEMO && status !== "in" && <Button asChild className="min-h-11"><Link prefetch={false} href="/login?returnTo=%2Fsettings%3Fsection%3Dmcp">Sign in to manage MCP</Link></Button>}
      </SettingsBlock>
    </SettingsSection>
  );
  return <OwnerMcpSection />;
}

function OwnerMcpSection() {
  const { state, error, reload } = useMcpState();
  const [page, setPage] = useState<McpPage>("overview");
  const top = useRef<HTMLDivElement>(null);
  function navigate(next: McpPage) {
    setPage(next);
    requestAnimationFrame(() => { top.current?.focus(); top.current?.scrollIntoView({ block: "nearest" }); });
  }
  if (error) return <SettingsBlock className="space-y-3"><p role="alert" className="text-sm">{error}</p><Button variant="secondary" onClick={reload}>Try again</Button><Button asChild variant="ghost"><Link prefetch={false} href="/login?returnTo=%2Fsettings%3Fsection%3Dmcp">Sign in</Link></Button></SettingsBlock>;
  if (!state) return <SettingsBlock><p role="status" className="text-sm">Loading MCP settings…</p></SettingsBlock>;
  if (!state.enabled) return (
    <SettingsSection icon={<Plug />} title="MCP is off">
      <SettingsBlock className="space-y-3 py-4">
        <p className="text-sm">Enable MCP on this host before connecting an AI app.</p>
        <McpCopyField label="Starting configuration in .env.local" value={"OS_MCP_ENABLED=1\nOS_MCP_MAX_SCOPE=read"} multiline />
        <p className="text-sm text-muted-foreground">Apply with <code>mso update --rebuild</code>. Start with read access and expand permissions only when needed.</p>
      </SettingsBlock>
    </SettingsSection>
  );
  return (
    <div ref={top} tabIndex={-1} data-slot="mcp-page" className="space-y-4 outline-none">
      {page === "overview" && <p className="text-sm leading-relaxed text-muted-foreground">Connect an AI app to this server, then manage its access here. Each app receives only the permissions you approve.</p>}
      <McpNavigation active={page} onSelect={navigate} activeCount={state.tokens.filter(token => token.status === "active").length} />
      {page === "connect" && <McpSetupGuide origin={state.origin} maxScope={state.maxScope} />}
      {page === "connection" && <McpConnectionSection origin={state.origin} />}
      {page === "access" && <McpTokenSection tokens={state.tokens} onChanged={reload} onConnect={() => navigate("connect")} />}
      {page === "activity" && <McpActivity />}
      {page === "tools" && <McpToolsetCard info={state.toolset} />}
    </div>
  );
}
