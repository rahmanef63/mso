"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { SelectContent, SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";

// One bounded provider list for every place that renders providers (Settings → AI
// and the Alfa cockpit). The content is capped at a fixed height instead of a
// viewport-derived one, so a long catalog can never grow to viewport height. Radix's viewport stays THE scroll container, so every
// option is still reachable by wheel, scroll buttons and keyboard — the cap never
// hides options without a way to reach them.
//
// 18rem ≈ 7 rows of 2.5rem plus the filter row: enough to compare providers side
// by side, under half of a 768px-tall laptop viewport, and still scrollable on a
// phone. 20rem would push the trigger off small landscape viewports with no gain.
export const PROVIDER_LIST_MAX_HEIGHT_REM = 18;
export const PROVIDER_LIST_CONTENT_CLASS = "max-h-[18rem] overflow-y-auto overflow-x-hidden";
export const PROVIDER_FILTER_THRESHOLD = 8;

export type ProviderRow = { id: string; text: string };
export type ProviderGroup = { label: string; rows: ProviderRow[] };

/** Case-insensitive match on the option id or its visible text. Groups whose
 * members are all filtered out are dropped, so no orphan label survives. */
export function filterProviderGroups(groups: ProviderGroup[], query: string): ProviderGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups
    .map((group) => ({
      label: group.label,
      rows: group.rows.filter(
        (row) => row.id.toLowerCase().includes(needle) || row.text.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.rows.length > 0);
}

export function countProviderRows(groups: ProviderGroup[]): number {
  return groups.reduce((total, group) => total + group.rows.length, 0);
}

/** Options only — no Radix portal — so it can be asserted in a plain render.
 * Shows the type-to-filter input only past the threshold; a user with a handful
 * of providers still gets the plain list. */
export function ProviderListBody({
  groups,
  filterLabel = "Filter providers",
  emptyLabel = "No providers match that filter.",
}: {
  groups: ProviderGroup[];
  filterLabel?: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filterable = countProviderRows(groups) > PROVIDER_FILTER_THRESHOLD;
  const visible = filterProviderGroups(groups, query);

  // Focus the filter after Radix focuses the selected item so a keyboard user can
  // type instead of scrolling. Skipped on coarse pointers (no unasked soft
  // keyboard). Focus stays inside Radix's FocusScope either way.
  useEffect(() => {
    if (!filterable) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [filterable]);

  return (
    <>
      {filterable ? (
        <div className="sticky top-0 z-10 -mx-1 border-b border-border bg-popover px-2 py-1.5">
          <Input
            ref={inputRef}
            aria-label={filterLabel}
            autoComplete="off"
            placeholder="Type to filter…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // The input owns printable characters; Radix would otherwise treat
              // them as typeahead and jump the focused option. Arrows and Tab
              // still bubble so focus can move into the options.
              if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.stopPropagation();
              }
            }}
            className="h-8 text-sm"
          />
        </div>
      ) : null}
      {visible.map((group) => (
        <SelectGroup key={group.label}>
          <SelectLabel>{group.label}</SelectLabel>
          {group.rows.map((row) => (
            <SelectItem key={row.id} value={row.id} className="[@media(pointer:coarse)]:min-h-[44px]">
              {row.text}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
      {visible.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {emptyLabel}
          {query.trim() ? ` (${query.trim()})` : ""}
        </p>
      ) : null}
    </>
  );
}

/** The bounded, scrollable content shared by both provider selects. */
export function ProviderSelectContent({
  groups,
  position = "popper",
  filterLabel,
  emptyLabel,
}: {
  groups: ProviderGroup[];
  position?: "item-aligned" | "popper";
  filterLabel?: string;
  emptyLabel?: string;
}) {
  return (
    <SelectContent position={position} align="start" className={PROVIDER_LIST_CONTENT_CLASS}>
      <ProviderListBody groups={groups} filterLabel={filterLabel} emptyLabel={emptyLabel} />
    </SelectContent>
  );
}
