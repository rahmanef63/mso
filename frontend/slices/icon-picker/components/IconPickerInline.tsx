"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { parseIconValue } from "../lib/parse";
import { useIconStyle, type Style } from "../lib/style-pref";
import { useRecentIcons } from "../lib/recents";
import { filterEmoji, filterLucide, filterPhosphor } from "../lib/search-haystacks";
import {
  buildPickerHandlers, getSearchPlaceholder, handleGridArrowKey,
  type TopTab, type IconVariant,
} from "../lib/picker-handlers";
import { PickerToolbar, VariantPills } from "./picker-parts/Toolbar";
import { ColorRow } from "./picker-parts/ColorRow";

// Per-tab code-split. EmojiTab carries the emoji catalog (~600 strings);
// IconTab carries the lucide + phosphor icon component imports (~440
// named imports). Splitting per tab means the user only downloads the
// catalog for the tab they actually open.
const EmojiTab = React.lazy(() =>
  import("./picker-parts/EmojiTab").then((m) => ({ default: m.EmojiTab })),
);
const IconTab = React.lazy(() =>
  import("./picker-parts/IconTab").then((m) => ({ default: m.IconTab })),
);

function TabFallback() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
      Loading…
    </div>
  );
}

export interface IconPickerInlineProps {
  value: string | null | undefined;
  /** Fired on every value change — icon pick, color pick, clear. */
  onChange: (next: string) => void;
  onClear?: () => void;
  /** Fired ONLY on icon-pick events (emoji / lucide / phosphor / recent /
   *  random / clear). NOT fired on color pick. */
  onSelect?: () => void;
  className?: string;
}

/** Inline picker.
 *
 *  Top tabs: Emoji | Icon. Sub-variant pills per tab:
 *    - Emoji → Native | Twemoji  (switches global `iconStyle` pref)
 *    - Icon  → Lucide (stroke) | Phosphor (fill)
 *
 *  ColorRow shows on the Icon tab (lucide + phosphor both accept color).
 *
 *  Perf contract: ONE `useIconStyle` here, propagated as a prop to every
 *  cell via `RawIcon` (zero per-cell hooks). Grids use
 *  `content-visibility: auto` for free row windowing. Search filter runs
 *  in `startTransition` over a precomputed haystack. Panels are mounted only
 *  for the active tab because MSO's Tabs has no TabsContent. */
export function IconPickerInline({ value, onChange, onClear, onSelect, className }: IconPickerInlineProps) {
  const parsed = parseIconValue(value);
  const initialTab: TopTab = parsed.kind === "lucide" || parsed.kind === "phosphor" ? "icon" : "emoji";
  const initialIconVariant: IconVariant = parsed.kind === "phosphor" ? "phosphor" : "lucide";

  const [tab, setTab] = React.useState<TopTab>(initialTab);
  const [iconVariant, setIconVariant] = React.useState<IconVariant>(initialIconVariant);
  const [queryInput, setQueryInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [isPending, startTransition] = React.useTransition();
  const [iconStyle, setIconStyle] = useIconStyle();
  const recents = useRecentIcons();

  const colorEnabled = tab === "icon";
  const currentColor =
    colorEnabled && (parsed.kind === "lucide" || parsed.kind === "phosphor")
      ? parsed.color
      : undefined;

  React.useEffect(() => {
    startTransition(() => setQuery(queryInput.trim().toLowerCase()));
  }, [queryInput]);

  const filteredEmoji = React.useMemo(() => filterEmoji(query), [query]);
  const filteredLucide = React.useMemo(() => filterLucide(query), [query]);
  const filteredPhosphor = React.useMemo(() => filterPhosphor(query), [query]);

  const activeValue = value ?? "";

  const handlers = buildPickerHandlers({
    parsed, tab, iconVariant, currentColor, colorEnabled,
    onChange, onClear, onSelect, currentValue: activeValue,
  });

  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => handleGridArrowKey(e, gridRef);

  return (
    <div
      className={cn("flex h-full min-h-0 w-full flex-col gap-3", className)}
      onKeyDown={onKeyDown}
      ref={gridRef}
    >
      <Tabs className="flex min-h-0 w-full flex-1 flex-col">
        <PickerToolbar tab={tab} onTabChange={setTab} onRandom={handlers.pickRandom} onClear={onClear ? handlers.handleClear : undefined} />

        <div className="mt-2 flex shrink-0 items-center gap-2">
          {tab === "emoji" ? (
            <VariantPills
              value={iconStyle}
              onChange={(v: Style) => setIconStyle(v)}
              options={[
                { value: "native",  label: "Native",  hint: "Render with the OS emoji font" },
                { value: "twemoji", label: "Twemoji", hint: "Render with Twemoji SVG (Notion-style, consistent across devices)" },
              ]}
            />
          ) : (
            <VariantPills
              value={iconVariant}
              onChange={(v: IconVariant) => setIconVariant(v)}
              options={[
                { value: "lucide",   label: "Lucide",        hint: "Outline icons (stroke)" },
                { value: "phosphor", label: "Phosphor fill", hint: "Filled icons (solid) — uses chosen color" },
              ]}
            />
          )}
        </div>

        {colorEnabled && (
          <div className="mt-2 shrink-0">
            <ColorRow currentColor={currentColor} onPick={handlers.pickColor} />
          </div>
        )}

        <div className="relative mt-2 shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={getSearchPlaceholder(tab, iconVariant, iconStyle)}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            className={cn("pl-7 h-8 text-sm", isPending && "opacity-80")}
            aria-busy={isPending}
          />
        </div>

        {tab === "emoji" ? (
          <div className="mt-2 flex flex-col flex-1 min-h-0">
            <React.Suspense fallback={<TabFallback />}>
              <EmojiTab
                filtered={filteredEmoji}
                parsed={parsed}
                iconStyle={iconStyle}
                recents={recents}
                activeValue={activeValue}
                onPickEmoji={handlers.pickEmoji}
                onPickRecent={handlers.pickRecent}
              />
            </React.Suspense>
          </div>
        ) : (
          <div className="mt-2 flex flex-col flex-1 min-h-0">
            <React.Suspense fallback={<TabFallback />}>
              <IconTab
                variant={iconVariant}
                filteredLucide={filteredLucide}
                filteredPhosphor={filteredPhosphor}
                parsed={parsed}
                iconStyle={iconStyle}
                currentColor={currentColor}
                recents={recents}
                activeValue={activeValue}
                onPickLucide={handlers.pickLucide}
                onPickPhosphor={handlers.pickPhosphor}
                onPickRecent={handlers.pickRecent}
              />
            </React.Suspense>
          </div>
        )}
      </Tabs>
    </div>
  );
}

export default IconPickerInline;
