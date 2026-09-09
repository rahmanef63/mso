"use client";

import { cn } from "@/lib/utils";

// Lightweight token-based toggle (no extra radix dep). shadcn-shaped API.
function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn("relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40", className)}
    >
      <span aria-hidden className={cn("inline-flex h-5 w-9 items-center rounded-full transition-colors", checked ? "bg-primary" : "bg-muted-foreground/40")}>
        <span className={cn("inline-block size-4 rounded-full bg-primary-foreground shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

export { Switch };
