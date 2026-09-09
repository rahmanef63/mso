"use client";

import { Bot, TerminalSquare } from "lucide-react";
import { MCP_CLIENTS, type McpClientId, type McpGuideStep } from "./mcp-client-core";
import { McpCopyField } from "./mcp-copy-field";

type ClientRow = (typeof MCP_CLIENTS)[number];

function StepRow({ number, title, body, copy }: McpGuideStep & { number: number }) {
  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-secondary text-sm font-semibold">{number}</div>
      <div className="min-w-0 flex-1 space-y-2">
        <div><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p></div>
        {copy && <McpCopyField label={copy.label} value={copy.value} multiline={copy.multiline} />}
      </div>
    </div>
  );
}

export function McpClientSetup({
  client,
  selected,
  steps,
}: {
  client: McpClientId;
  selected: ClientRow;
  steps: McpGuideStep[];
}) {
  return (
    <>
      <div className="flex items-center gap-2 rounded-lg bg-secondary/35 px-3 py-2">
        {selected.kind === "cli" ? <TerminalSquare className="size-3.5 shrink-0" /> : <Bot className="size-3.5 shrink-0" />}
        <p className="text-sm text-muted-foreground">{selected.label} · {selected.description}</p>
      </div>
      <div className="space-y-5">{steps.map((step, index) => <StepRow key={`${client}-${step.title}`} number={index + 1} {...step} />)}</div>
      {client === "chatgpt" && (
        <details className="rounded-lg border border-border/70 bg-secondary/20 p-3">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Optional app name and description</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <McpCopyField label="Name" value="MSO" />
            <McpCopyField label="Description" value="Control this MSO host with scoped MCP tools" />
          </div>
        </details>
      )}
    </>
  );
}
