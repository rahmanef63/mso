"use client";

import { cn } from "@/lib/utils";

export type SegOption<T extends string> = { value: T; label: string };

// Segmented control (os-rr "Seg"). Token-styled, keyboard-clickable buttons.
function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      data-slot="segmented"
      className={cn(
        "inline-flex gap-1 rounded-lg border border-border bg-secondary p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-slot="segmented-option"
          data-selected={value === o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors min-h-11",
            value === o.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export { Segmented };
