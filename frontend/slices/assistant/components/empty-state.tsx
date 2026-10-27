"use client";

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Zero-message hero: Alfa intro + tappable suggested-prompt chips.
export function EmptyState({
  prompts,
  onPick,
}: {
  prompts: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
        <Sparkles className="size-6" />
      </span>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Ask Alfa</h2>
        <p className="text-sm text-muted-foreground">
          Your VPS copilot: describe a task and Alfa lays out the commands.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {prompts.map((p) => (
          <Badge
            key={p}
            variant="secondary"
            onClick={() => onPick(p)}
            className={cn(
              "cursor-pointer items-center px-3 py-1 text-xs font-normal [@media(pointer:coarse)]:min-h-[44px]",
              "hover:bg-secondary/70",
            )}
          >
            {p}
          </Badge>
        ))}
      </div>
    </div>
  );
}
