"use client";

import { Bot, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { MCP_CLIENTS, type McpClientId, type McpGuideStep } from "./mcp-client-core";
import { McpCopyField } from "./mcp-copy-field";

type ClientRow = (typeof MCP_CLIENTS)[number];

function StepRow({ number, title, body, copy }: McpGuideStep & { number: number }) {
  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-secondary text-[11px] font-semibold">{number}</div>
      <div className="min-w-0 flex-1 space-y-2">
        <div><p className="text-[13px] font-medium">{title}</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p></div>
        {copy && <McpCopyField label={copy.label} value={copy.value} multiline={copy.multiline} />}
      </div>
    </div>
  );
}

export function McpClientSetup({
  client,
  onClientChange,
  selected,
  steps,
}: {
  client: McpClientId;
  onClientChange: (client: McpClientId) => void;
  selected: ClientRow;
  steps: McpGuideStep[];
}) {
  return (
    <>
      <div>
        <p className="text-[13px] font-medium">Client setup</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Choose a client to get its remote-MCP shape. Use Other MCP only for clients that explicitly support a Streamable HTTP URL.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {MCP_CLIENTS.map((item) => (
          <button key={item.id} type="button" aria-pressed={client === item.id} onClick={() => onClientChange(item.id)} className={cn(
            "min-h-16 rounded-lg border p-2.5 text-left transition-colors [@media(pointer:coarse)]:min-h-[72px]",
            client === item.id ? "border-primary/45 bg-primary/10" : "border-border/70 bg-secondary/25 hover:bg-secondary/50",
          )}>
            <span className="block text-xs font-medium">{item.label}</span>
            <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{item.description}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-secondary/35 px-3 py-2">
        {selected.kind === "cli" ? <TerminalSquare className="size-3.5 shrink-0" /> : <Bot className="size-3.5 shrink-0" />}
        <p className="text-[11px] text-muted-foreground">{selected.label} · {selected.description}</p>
      </div>
      {client === "chatgpt" && (
        <div className="grid gap-3 rounded-lg border border-border/70 bg-secondary/20 p-3 sm:grid-cols-2">
          <McpCopyField label="Name" value="MSO" />
          <McpCopyField label="Description" value="Control this MSO host with scoped MCP tools" />
          <McpCopyField label="Connection" value="Server URL · Streamable HTTP" />
          <McpCopyField label="Authentication" value="OAuth" />
        </div>
      )}
      <div className="space-y-5">{steps.map((step, index) => <StepRow key={`${client}-${step.title}`} number={index + 1} {...step} />)}</div>
    </>
  );
}
