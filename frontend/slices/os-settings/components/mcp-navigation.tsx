"use client";

import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import { ArrowLeft, ChevronRight, KeyRound, ListChecks, PlugZap, Settings2, Wrench } from "lucide-react";

export const MCP_PAGES = [
  { id: "connect", title: "Connect an app", description: "Choose ChatGPT, Claude, Cursor, or another client and follow its setup steps.", icon: PlugZap },
  { id: "access", title: "Connected apps", description: "Review permissions, last use, and expiry. Disconnect access you no longer need.", icon: KeyRound },
  { id: "activity", title: "Recent activity", description: "Review the latest actions requested through MCP.", icon: ListChecks },
  { id: "tools", title: "Tools & updates", description: "Check the server tool catalog and your last client refresh reminder.", icon: Wrench },
  { id: "connection", title: "Connection details", description: "Server address, reachability checks, tunnels, and manual OAuth settings.", icon: Settings2 },
  { id: "registry", title: "Plugins / Registry", description: "Review built-ins or validate a custom portable plugin declaration.", icon: Wrench },
] as const;
export type McpPage = "overview" | (typeof MCP_PAGES)[number]["id"];
export type McpDirection = "inbound" | "outbound";
export const pagesForDirection = (direction: McpDirection) => MCP_PAGES.filter(page => direction === "inbound" ? page.id !== "registry" : page.id === "registry");

export function McpNavigation({ active, onSelect, activeCount, direction }: { active: McpPage; onSelect: (page: McpPage) => void; activeCount: number; direction: McpDirection }) {
  if (active !== "overview") return (
    <nav aria-label="MCP navigation" className="flex flex-wrap items-center gap-2 text-sm">
      <Button variant="ghost" className="min-h-11 px-2" onClick={() => onSelect("overview")}><ArrowLeft className="size-4" /> MCP overview</Button>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      <span aria-current="page">{MCP_PAGES.find(page => page.id === active)?.title}</span>
    </nav>
  );
  return (
    <nav aria-label="MCP navigation">
      <SettingsBlock className="!p-0 divide-y divide-border">
        {pagesForDirection(direction).map(({ id, title, description, icon: Icon }) => (
          <Button key={id} variant="ghost" onClick={() => onSelect(id)} className="h-auto min-h-20 w-full justify-start gap-3 whitespace-normal rounded-none px-4 py-4 text-left">
            <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}{id === "access" ? ` (${activeCount})` : ""}</span><span className="mt-1 block text-sm font-normal leading-relaxed text-foreground">{description}</span></span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        ))}
      </SettingsBlock>
    </nav>
  );
}
