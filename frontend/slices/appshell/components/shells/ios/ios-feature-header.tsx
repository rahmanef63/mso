"use client";

import { ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function IosFeatureHeader({
  title,
  backLabel,
  onBack,
  onAI,
  scrolled,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  onAI: () => void;
  scrolled: boolean;
}) {
  return (
    <header
      data-slot="mobile-feature-header"
      className={cn(
        "shrink-0 border-b transition-[background-color,border-color] duration-200",
        scrolled ? "glass border-border bg-[var(--glass-bar)]" : "border-transparent bg-transparent",
      )}
      style={{ paddingTop: "var(--sai-top)" }}
    >
      <div className="relative flex h-[46px] items-center px-1.5">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          aria-label={`Back to ${backLabel}`}
          className="absolute left-1 top-1/2 h-[44px] max-w-[34%] -translate-y-1/2 gap-0 overflow-hidden px-1 text-[17px] font-normal text-info hover:bg-transparent hover:text-info"
        >
          <ChevronLeft className="size-[25px] shrink-0" aria-hidden />
          <span className="truncate">{backLabel}</span>
        </Button>
        <span className="mx-auto max-w-[44%] truncate text-[17px] font-semibold tracking-[-0.01em] text-foreground">{title}</span>
        <Button
          type="button"
          variant="ghost"
          aria-label="Ask AI"
          onClick={onAI}
          className="absolute right-1 top-1/2 grid size-[44px] -translate-y-1/2 place-items-center rounded-full p-0 text-info hover:bg-[var(--fill)] hover:text-info"
        >
          <Sparkles className="size-5" aria-hidden />
        </Button>
      </div>
    </header>
  );
}
