"use client";

import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProviderSelectContent, type ProviderGroup } from "./provider-filter-list";

export type ModelChoice = {
  id: string;
  name?: string;
  context?: number;
  free?: boolean;
  agentReady?: boolean;
  tools?: boolean;
  reasoning?: boolean;
};

const fmtCtx = (n?: number) => (!n ? "—" : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`);

/** One line per model, the same vocabulary the CLI picker prints: free first,
 * then context, then capability flags. The id stays visible because it is what
 * gets saved and what people paste into issues. */
export function modelOptionText(row: ModelChoice): string {
  const bits = [row.free ? "FREE" : null, `ctx ${fmtCtx(row.context)}`, row.tools ? "tools" : null, row.reasoning ? "reasoning" : null].filter(Boolean);
  const label = row.name && row.name !== row.id ? `${row.name} · ${row.id}` : row.id;
  return `${label} · ${bits.join(" · ")}`;
}

/** The model list for one provider. A plain Select (not free text): typing an
 * exact id from memory was the single most error-prone step in this section.
 * Rows come from /api/models plus any ids the owner declared for a custom
 * endpoint, de-duplicated by id with the declared row winning. */
export function AiModelSelect({
  provider,
  value,
  rows,
  customModels,
  onChange,
  disabled = false,
  placeholder = "Choose model",
}: {
  provider: string;
  value: string;
  rows: ModelChoice[];
  customModels?: string[];
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const seen = new Set((customModels ?? []).map((id) => id));
  const merged: ModelChoice[] = [
    ...(customModels ?? []).map((id) => rows.find((row) => row.id === id) ?? { id }),
    ...rows.filter((row) => !seen.has(row.id)),
  ];
  // A saved id that the catalog no longer lists must still render, otherwise the
  // trigger would blank out and look like nothing is selected.
  const options = value && !merged.some((row) => row.id === value) ? [{ id: value }, ...merged] : merged;
  const groups: ProviderGroup[] = [{
    label: options.length ? `${provider} · ${options.length} model${options.length === 1 ? "" : "s"}` : provider,
    rows: options.map((row) => ({ id: row.id, text: modelOptionText(row) })),
  }];

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="sm:w-72" aria-label="Model">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <ProviderSelectContent
        groups={groups}
        filterLabel="Filter models"
        emptyLabel="This provider lists no models yet. Use Manage models to add or discover them."
      />
    </Select>
  );
}
