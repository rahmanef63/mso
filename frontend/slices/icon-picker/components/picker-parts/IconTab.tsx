"use client";

import { LUCIDE_GROUPS } from "../../lib/lucide-catalog";
import { PHOSPHOR_GROUPS } from "../../lib/phosphor-catalog";
import type { Style } from "../../lib/style-pref";
import type { IconValue } from "../../lib/parse";
import { LucideCell, PhosphorCell, Grid, Empty } from "./cells";
import { RecentsSection, Section } from "./Sections";

export interface IconTabProps {
  variant: "lucide" | "phosphor";
  filteredLucide: string[] | null;
  filteredPhosphor: string[] | null;
  parsed: IconValue;
  iconStyle: Style;
  currentColor: string | undefined;
  recents: readonly string[];
  activeValue: string;
  onPickLucide: (n: string) => void;
  onPickPhosphor: (n: string) => void;
  onPickRecent: (v: string) => void;
}

/** Combined Lucide + Phosphor tab. Branches on `variant`. ScrollArea
 *  uses `h-full min-h-0 flex-1` so the flex column in IconPickerInline
 *  drives final height — works inside popover (capped by Radix avail-
 *  height var) AND inside dialog fallback (capped by dialog max-h). */
export function IconTab({
  variant,
  filteredLucide,
  filteredPhosphor,
  parsed,
  iconStyle,
  currentColor,
  recents,
  activeValue,
  onPickLucide,
  onPickPhosphor,
  onPickRecent,
}: IconTabProps) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto pr-2">
      {variant === "lucide"
        ? renderLucide({ filteredLucide, parsed, iconStyle, currentColor, recents, activeValue, onPickLucide, onPickRecent })
        : renderPhosphor({ filteredPhosphor, parsed, iconStyle, currentColor, recents, activeValue, onPickPhosphor, onPickRecent })}
    </div>
  );
}

function renderLucide({
  filteredLucide, parsed, iconStyle, currentColor, recents, activeValue, onPickLucide, onPickRecent,
}: Pick<IconTabProps, "filteredLucide" | "parsed" | "iconStyle" | "currentColor" | "recents" | "activeValue" | "onPickLucide" | "onPickRecent">) {
  if (filteredLucide) {
    return (
      <Grid>
        {filteredLucide.length === 0 ? <Empty /> : filteredLucide.map((n, i) => (
          <LucideCell
            key={`fl-${n}`}
            name={n}
            color={currentColor}
            style={iconStyle}
            active={parsed.kind === "lucide" && parsed.name === n}
            onClick={() => onPickLucide(n)}
            tabIndex={i === 0 ? 0 : -1}
            index={i}
          />
        ))}
      </Grid>
    );
  }
  return (
    <div className="space-y-3">
      {recents.length > 0 && (
        <RecentsSection
          recents={recents}
          style={iconStyle}
          activeValue={activeValue}
          onPick={onPickRecent}
        />
      )}
      {LUCIDE_GROUPS.map((g) => (
        <Section key={g.id} label={g.label}>
          {g.items.map((n) => (
            <LucideCell
              key={`${g.id}-${n}`}
              name={n}
              color={currentColor}
              style={iconStyle}
              active={parsed.kind === "lucide" && parsed.name === n}
              onClick={() => onPickLucide(n)}
            />
          ))}
        </Section>
      ))}
    </div>
  );
}

function renderPhosphor({
  filteredPhosphor, parsed, iconStyle, currentColor, recents, activeValue, onPickPhosphor, onPickRecent,
}: Pick<IconTabProps, "filteredPhosphor" | "parsed" | "iconStyle" | "currentColor" | "recents" | "activeValue" | "onPickPhosphor" | "onPickRecent">) {
  if (filteredPhosphor) {
    return (
      <Grid>
        {filteredPhosphor.length === 0 ? <Empty /> : filteredPhosphor.map((n, i) => (
          <PhosphorCell
            key={`fp-${n}`}
            name={n}
            color={currentColor}
            style={iconStyle}
            active={parsed.kind === "phosphor" && parsed.name === n}
            onClick={() => onPickPhosphor(n)}
            tabIndex={i === 0 ? 0 : -1}
            index={i}
          />
        ))}
      </Grid>
    );
  }
  return (
    <div className="space-y-3">
      {recents.length > 0 && (
        <RecentsSection
          recents={recents}
          style={iconStyle}
          activeValue={activeValue}
          onPick={onPickRecent}
        />
      )}
      {PHOSPHOR_GROUPS.map((g) => (
        <Section key={`p-${g.id}`} label={g.label}>
          {g.items.map((n) => (
            <PhosphorCell
              key={`p-${g.id}-${n}`}
              name={n}
              color={currentColor}
              style={iconStyle}
              active={parsed.kind === "phosphor" && parsed.name === n}
              onClick={() => onPickPhosphor(n)}
            />
          ))}
        </Section>
      ))}
    </div>
  );
}
