"use client";

import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { groupProviderOptions, type ProviderSummary } from "./ai-provider-options";
import { type ConnectedProvider } from "./provider-list";

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
  const groups = groupProviderOptions(options);
  const selected = options.find((row) => row.id === value);
  return (
    <div className="space-y-1.5">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
        <SelectContent>
          {groups.free.length > 0 && (
            <SelectGroup>
              <SelectLabel>Free AI available</SelectLabel>
              {groups.free.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name} · {row.freeAgentModelCount} free agent-ready
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {groups.other.length > 0 && (
            <SelectGroup>
              <SelectLabel>Other providers</SelectLabel>
              {groups.other.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}
            </SelectGroup>
          )}
          {connectedExtras.length > 0 && (
            <SelectGroup>
              <SelectLabel>Connected</SelectLabel>
              {connectedExtras.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.id}{row.kind === "oauth" ? " (OAuth)" : row.kind === "custom" ? " (Custom)" : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {selected && selected.freeAgentModelCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {selected.freeAgentModelCount} agent-ready free model{selected.freeAgentModelCount === 1 ? "" : "s"} currently reported.
        </p>
      )}
    </div>
  );
}
