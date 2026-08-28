"use client";

import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { AIStore } from "../lib/store";
import { OS_TOOLS } from "../lib/tools";
import type { Agent, Skill } from "../lib/types";
import { GlyphTile } from "./agent-avatar";

// Agents/Skills card grid. Presets are non-deletable; agents can be set active.
export function LibraryGrid({
  kind,
  store,
  onNew,
  onEdit,
}: {
  kind: "agent" | "skill";
  store: AIStore;
  onNew: () => void;
  onEdit: (item: Agent | Skill) => void;
}) {
  const isAgent = kind === "agent";
  const items: (Agent | Skill)[] = isAgent ? store.agents : store.skills;

  const toolCount = (it: Agent | Skill) => isAgent ? OS_TOOLS.length : (it as Skill).tools.length;

  return (
    <ScrollArea className="flex-1">
      <div className="p-5 [padding-bottom:calc(1.25rem+var(--sai-bottom))]">
        <div className="mb-3.5 flex items-center">
          <div>
            <div className="text-base font-bold tracking-tight">{isAgent ? "Agents" : "Skills"}</div>
            <div className="text-xs text-muted-foreground">
              {isAgent
                ? "Personas share one global tool catalog; skills organize instructions, not grants."
                : "Bundles of tools + instructions you give to agents."}
            </div>
          </div>
          <Button size="sm" className="ml-auto [@media(pointer:coarse)]:min-h-[44px]" onClick={onNew}>
            <Plus className="size-3.5" /> New {isAgent ? "agent" : "skill"}
          </Button>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {items.map((it) => {
            const active = isAgent && it.id === store.activeAgentId;
            return (
              <div
                key={it.id}
                className="glass flex flex-col gap-2.5 rounded-xl border border-border bg-card/40 p-3.5"
              >
                <div className="flex items-center gap-2.5">
                  <GlyphTile glyph={it.glyph} color={it.color} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {it.name}
                      {it.builtin ? (
                        <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase">
                          preset
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {toolCount(it)} {isAgent ? "global tools" : "tools"}
                    </div>
                  </div>
                </div>
                <div className="min-h-9 text-xs leading-relaxed text-muted-foreground">
                  {(isAgent ? (it as Agent).persona : (it as Skill).instructions) || (
                    <span className="opacity-60">No description.</span>
                  )}
                </div>
                <div className="mt-auto flex gap-1.5">
                  {isAgent ? (
                    <Button
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() => store.setActiveAgentId(it.id)}
                    >
                      {active ? "Active" : "Use"}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => onEdit(it)}>
                    Edit
                  </Button>
                  {!it.builtin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn("text-destructive")}
                      onClick={() =>
                        isAgent ? store.removeAgent(it.id) : store.removeSkill(it.id)
                      }
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
