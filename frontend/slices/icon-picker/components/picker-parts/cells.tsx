import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { lucideValue, phosphorValue } from "../../lib/parse";
import { RawIcon } from "../DynamicIcon";
import type { Style } from "../../lib/style-pref";

/** 8-col grid with `content-visibility:auto` so the browser can skip
 *  rendering offscreen rows entirely. `contain-intrinsic-size` keeps
 *  the scroll height stable while content is skipped. Combined with
 *  one section per category, this approximates virtualization without
 *  any JS-side measurement. */
export function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid grid-cols-8 gap-1"
      style={{ contentVisibility: "auto", containIntrinsicSize: "0 320px" } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

interface CellProps {
  active: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  tabIndex?: number;
  /** Set by the picker once it knows the cell's index, so keyboard nav
   *  can walk siblings via the data attribute. */
  index?: number;
}

interface EmojiCellProps extends CellProps {
  emoji: string;
  style: Style;
}

function EmojiCellImpl({ emoji, active, onClick, onMouseEnter, tabIndex, index, style }: EmojiCellProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      tabIndex={tabIndex}
      data-icon-cell-index={index}
      className={cn(
        "flex h-auto h-8 w-8 items-center justify-center rounded text-lg leading-none transition",
        active ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-accent",
      )}
      title={emoji}
      aria-label={`Pick ${emoji}`}
    >
      <RawIcon value={emoji} style={style} className="text-lg" />
    </Button>
  );
}

export const EmojiCell = React.memo(EmojiCellImpl);

interface LucideCellProps extends CellProps {
  name: string;
  color: string | undefined;
  style: Style;
}

function LucideCellImpl({ name, color, active, onClick, onMouseEnter, tabIndex, index, style }: LucideCellProps) {
  const value = React.useMemo(() => lucideValue(name, color), [name, color]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      tabIndex={tabIndex}
      data-icon-cell-index={index}
      className={cn(
        "flex h-auto h-8 w-8 items-center justify-center rounded text-lg leading-none transition",
        active ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-accent",
      )}
      title={name}
      aria-label={`Pick ${name}`}
    >
      <RawIcon value={value} style={style} className="text-lg" />
    </Button>
  );
}

export const LucideCell = React.memo(LucideCellImpl);

interface PhosphorCellProps extends CellProps {
  name: string;
  color: string | undefined;
  style: Style;
}

function PhosphorCellImpl({ name, color, active, onClick, onMouseEnter, tabIndex, index, style }: PhosphorCellProps) {
  const value = React.useMemo(() => phosphorValue(name, color), [name, color]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      tabIndex={tabIndex}
      data-icon-cell-index={index}
      className={cn(
        "flex h-auto h-8 w-8 items-center justify-center rounded text-lg leading-none transition",
        active ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-accent",
      )}
      title={name}
      aria-label={`Pick ${name}`}
    >
      <RawIcon value={value} style={style} className="text-lg" />
    </Button>
  );
}

export const PhosphorCell = React.memo(PhosphorCellImpl);

/** Renders a recent entry — value may be either emoji or `lucide:Name`,
 *  with optional color suffix. */
interface RecentCellProps extends CellProps {
  value: string;
  style: Style;
}

function RecentCellImpl({ value, active, onClick, onMouseEnter, tabIndex, index, style }: RecentCellProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      tabIndex={tabIndex}
      data-icon-cell-index={index}
      className={cn(
        "flex h-auto h-8 w-8 items-center justify-center rounded text-lg leading-none transition",
        active ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-accent",
      )}
      title={value}
      aria-label={`Pick recent ${value}`}
    >
      <RawIcon value={value} style={style} className="text-lg" />
    </Button>
  );
}

export const RecentCell = React.memo(RecentCellImpl);

export function Empty() {
  return (
    <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
      No matches.
    </div>
  );
}
