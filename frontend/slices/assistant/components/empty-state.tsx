"use client";

import { ArrowUpRight, Sparkles } from "lucide-react";

// Zero-message hero: clean AI chat welcome + keyboard-accessible prompt cards.
export function EmptyState({
  prompts,
  onPick,
}: {
  prompts: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-5 px-5 py-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Ask Alfa</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Describe a task or question. Alfa reads context, runs approved tools, and answers in one thread.
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="group flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border bg-card/60 px-3.5 py-2.5 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-accent/60"
          >
            <span className="line-clamp-2 leading-snug">{p}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}
