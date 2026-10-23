"use client";

import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { groupProviderOptions, type ProviderSummary } from "./ai-provider-options";
import { ProviderSelectContent, type ProviderGroup } from "./provider-filter-list";
import { type ConnectedProvider } from "./provider-list";

/** The Settings → AI provider list, grouped exactly as before but rendered by the
 * shared bounded/filterable content so a long catalog cannot grow to viewport
 * height. */
export function providerGroups(
  options: ProviderSummary[],
  connectedExtras: ConnectedProvider[],
): ProviderGroup[] {
  const groups = groupProviderOptions(options);
  const rows: ProviderGroup[] = [];
  if (groups.free.length > 0) {
    rows.push({
      label: "Free AI available",
      rows: groups.free.map((row) => ({
        id: row.id,
        text: `${row.name} · ${row.freeAgentModelCount} free agent-ready`,
      })),
    });
  }
  if (groups.other.length > 0) {
    rows.push({ label: "Other providers", rows: groups.other.map((row) => ({ id: row.id, text: row.name })) });
  }
  if (connectedExtras.length > 0) {
    rows.push({
      label: "Connected",
      rows: connectedExtras.map((row) => ({
        id: row.id,
        text: `${row.id}${row.kind === "oauth" ? " (OAuth)" : row.kind === "custom" ? " (Custom)" : ""}`,
      })),
    });
  }
  return rows;
}

export function AiProviderSelect({
  value,
  options,
  connectedExtras,
  onChange,
}: {
  value: string;
  options: ProviderSummary[];
  connectedExtras: ConnectedProvider[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((row) => row.id === value);
  return (
    <div className="space-y-1.5">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
        <ProviderSelectContent groups={providerGroups(options, connectedExtras)} />
      </Select>
      {selected && selected.freeAgentModelCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {selected.freeAgentModelCount} agent-ready free model{selected.freeAgentModelCount === 1 ? "" : "s"} currently reported.
        </p>
      )}
    </div>
  );
}
