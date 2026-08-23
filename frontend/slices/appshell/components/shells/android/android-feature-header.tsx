"use client";

import { ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { M3_PRESS } from "./android-motion";

export function AndroidFeatureHeader({
  title,
  backLabel,
  onBack,
  onAI,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  onAI: () => void;
}) {
  return (
    <header
      data-slot="mobile-feature-header"
      className="relative flex shrink-0 items-center border-b border-border bg-card px-1 text-foreground"
      style={{ height: "calc(3.5rem + var(--sai-top, 0px))", paddingTop: "var(--sai-top, 0px)" }}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        aria-label={`Back to ${backLabel}`}
        className={`absolute left-1 top-[calc(var(--sai-top,0px)+1.75rem)] h-12 max-w-[34%] -translate-y-1/2 gap-0 overflow-hidden rounded-full px-1.5 text-[15px] font-medium hover:bg-secondary ${M3_PRESS}`}
      >
        <ChevronLeft className="size-6 shrink-0" aria-hidden />
        <span className="truncate">{backLabel}</span>
      </Button>
      <span className="mx-auto max-w-[44%] truncate text-center text-[18px] font-medium">{title}</span>
      <Button
        type="button"
        variant="ghost"
        onClick={onAI}
        aria-label="Ask AI"
        className={`absolute right-1 top-[calc(var(--sai-top,0px)+1.75rem)] grid size-12 -translate-y-1/2 place-items-center rounded-full p-0 hover:bg-secondary ${M3_PRESS}`}
      >
        <Sparkles className="size-5" aria-hidden />
      </Button>
    </header>
  );
}
