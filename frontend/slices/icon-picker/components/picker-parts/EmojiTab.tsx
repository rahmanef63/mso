"use client";

import { EMOJI_GROUPS } from "../../lib/emoji-catalog";
import type { Style } from "../../lib/style-pref";
import type { IconValue } from "../../lib/parse";
import { EmojiCell, Grid, Empty } from "./cells";
import { RecentsSection, Section } from "./Sections";

export interface EmojiTabProps {
  filtered: string[] | null;
  parsed: IconValue;
  iconStyle: Style;
  recents: readonly string[];
  activeValue: string;
  onPickEmoji: (e: string) => void;
  onPickRecent: (v: string) => void;
}

export function EmojiTab({
  filtered,
  parsed,
  iconStyle,
  recents,
  activeValue,
  onPickEmoji,
  onPickRecent,
}: EmojiTabProps) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto pr-2">
      {filtered ? (
        <Grid>
          {filtered.length === 0 ? <Empty /> : filtered.map((e, i) => (
            <EmojiCell
              key={`f-${e}-${i}`}
              emoji={e}
              style={iconStyle}
              active={parsed.kind === "emoji" && parsed.emoji === e}
              onClick={() => onPickEmoji(e)}
              tabIndex={i === 0 ? 0 : -1}
              index={i}
            />
          ))}
        </Grid>
      ) : (
        <div className="space-y-3">
          {recents.length > 0 && (
            <RecentsSection
              recents={recents}
              style={iconStyle}
              activeValue={activeValue}
              onPick={onPickRecent}
            />
          )}
          {EMOJI_GROUPS.map((g) => (
            <Section key={g.id} label={g.label}>
              {g.items.map((e, i) => (
                <EmojiCell
                  key={`${g.id}-${e}-${i}`}
                  emoji={e}
                  style={iconStyle}
                  active={parsed.kind === "emoji" && parsed.emoji === e}
                  onClick={() => onPickEmoji(e)}
                />
              ))}
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
