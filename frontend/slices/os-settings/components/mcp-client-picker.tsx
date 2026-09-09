"use client";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { MCP_CLIENTS, type McpClientId } from "./mcp-client-core";
export function McpClientPicker({ onSelect }: { onSelect: (client: McpClientId) => void }) {
  return <section aria-label="Choose an app" className="space-y-3">
    <h3 className="text-base font-semibold">Which app do you want to connect?</h3>
    <p className="text-sm text-muted-foreground">Choose one to see only the steps it needs.</p>
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      {MCP_CLIENTS.map(client => <Button key={client.id} variant="ghost" onClick={() => onSelect(client.id)} className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal rounded-none px-4 py-3 text-left">
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{client.label}</span><span className="mt-1 block text-sm font-normal text-muted-foreground">{client.description}</span></span><ChevronRight className="size-4 shrink-0" aria-hidden />
      </Button>)}
    </div>
  </section>;
}
