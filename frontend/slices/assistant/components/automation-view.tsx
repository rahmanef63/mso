"use client";

import { Play, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AIStore } from "../lib/store";
import { toolById } from "../lib/tools";
import type { Automation } from "../lib/types";
import { GlyphTile } from "./agent-avatar";

// Saved multi-step flows. Run uses Alfa's normal tool loop, so mutations keep the same approval gate.
export function AutomationView({
  store,
  onRun,
  onNew,
  onEdit,
}: {
  store: AIStore;
  onRun: (a: Automation) => void;
  onNew: () => void;
  onEdit: (a: Automation) => void;
}) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-5 [padding-bottom:calc(1.25rem+var(--sai-bottom))]">
        <div className="mb-3.5 flex items-center">
          <div>
            <div className="text-base font-bold tracking-tight">Automations</div>
            <div className="text-xs text-muted-foreground">
              Saved flows — an ordered list of tool steps you can run in one click.
            </div>
          </div>
          <Button size="sm" className="ml-auto" onClick={onNew}>
            <Plus className="size-3.5" /> New automation
          </Button>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {store.automations.map((au) => {
            const agent = store.agents.find((a) => a.id === au.agentId);
            return (
              <div
                key={au.id}
                className="glass flex flex-col gap-2.5 rounded-xl border border-border bg-card/40 p-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <GlyphTile glyph={au.glyph} color={au.color} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {au.name}
                      {au.builtin ? (
                        <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase">
                          preset
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {au.steps.length} steps · {agent?.name ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {au.steps.slice(0, 4).map((s, i) => {
                    const t = toolById(s.tool);
                    return (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="w-4 text-right tabular-nums opacity-60">{i + 1}</span>
                        <span className="truncate">{t?.name ?? s.tool}</span>
                      </div>
                    );
                  })}
                  {au.steps.length > 4 ? (
                    <div className="pl-6 text-[11px] text-muted-foreground opacity-70">
                      +{au.steps.length - 4} more
                    </div>
                  ) : null}
                </div>
                <div className="mt-auto flex gap-1.5">
                  <Button size="sm" onClick={() => onRun(au)}>
                    <Play className="size-3" /> Run
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onEdit(au)}>
                    Edit
                  </Button>
                  {!au.builtin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => store.removeAutomation(au.id)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
