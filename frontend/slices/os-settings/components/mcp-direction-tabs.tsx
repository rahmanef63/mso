"use client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export const MCP_TABS = [
  { id: "inbound", title: "Access MSO", description: "External clients → MSO" },
  { id: "outbound", title: "MSO Access", description: "MSO → external services" },
  { id: "sessions", title: "Sessions", description: "Activity & handover" },
] as const;
export type McpTab = (typeof MCP_TABS)[number]["id"];
export function McpDirectionTabs({ value, onChange }: { value: McpTab; onChange: (value: McpTab) => void }) {
  return <div role="tablist" aria-label="MCP direction" className="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1">
    {MCP_TABS.map((item, index) => <Button key={item.id} id={`mcp-${item.id}-tab`} type="button" variant="ghost"
      role="tab" aria-selected={value === item.id} aria-controls="mcp-direction-panel"
      tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)}
      onKeyDown={event => {
        const next = event.key === "Home" ? 0 : event.key === "End" ? MCP_TABS.length - 1
          : event.key === "ArrowRight" ? (index + 1) % MCP_TABS.length
          : event.key === "ArrowLeft" ? (index + MCP_TABS.length - 1) % MCP_TABS.length : -1;
        if (next < 0) return;
        event.preventDefault(); onChange(MCP_TABS[next].id);
        document.getElementById(`mcp-${MCP_TABS[next].id}-tab`)?.focus();
      }}
      className={cn("h-auto min-h-11 min-w-0 flex-col items-start whitespace-normal px-2 py-2 text-left",
        value === item.id ? "bg-card shadow-sm" : "text-muted-foreground")}>
      <span className="text-sm font-medium">{item.title}</span>
      <span className="hidden text-xs font-normal leading-relaxed sm:block">{item.description}</span>
    </Button>)}
  </div>;
}
