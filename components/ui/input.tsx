import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "flex h-[var(--ui-control-height,2rem)] w-full rounded-md border border-input bg-secondary px-2.5 py-1 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-base",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
