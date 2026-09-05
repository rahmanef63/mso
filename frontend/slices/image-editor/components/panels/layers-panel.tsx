"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock, SquareDashed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEditor } from "../../lib/store";
import type { Layer } from "../../lib/types";
import { LayerThumb } from "./layer-thumb";
import { LayerActionsMenu } from "./layer-actions-menu";
import { LayersHeader } from "./layers-header";
import { LayersFooter } from "./layers-footer";

const KIND_LABEL: Record<Layer["kind"], string> = {
  image: "IMG",
  text: "TEXT",
  shape: "SHAPE",
  paint: "PIXEL",
  adjustment: "ADJ",
};

// Compact, Photoshop-style Layers panel:
//   header  → blend + opacity (selected layer)
//   rows    → [eye | thumbnail | name | ⋮ actions]  (drag to reorder)
//   footer  → New ▾ / Duplicate / Crop / Delete action bar
// Per-row controls collapse to the eye (left) + the kebab menu (right) so the
// list reads dense like Photoshop; everything else lives in header/footer/menu.
export function LayersPanel() {
  const ed = useEditor();
  const { doc, selectedId } = ed;
  const [editing, setEditing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const rows = [...doc.layers].reverse();
  const toReal = (display: number) => doc.layers.length - 1 - display;
  const resetDrag = () => { setDragIdx(null); setOverIdx(null); };
  const onDrop = (to: number) => {
    if (dragIdx !== null && dragIdx !== to) ed.reorder(toReal(dragIdx), toReal(to));
    resetDrag();
  };

  return (
    <div className="flex h-full flex-col bg-card text-foreground">
      <LayersHeader />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {rows.map((l: Layer, di: number) => {
            const isSel = l.id === selectedId;
            const isOver = overIdx === di && dragIdx !== null && dragIdx !== di;
            return (
              <div
                key={l.id}
                draggable
                onDragStart={() => setDragIdx(di)}
                onDragOver={(e) => { e.preventDefault(); if (overIdx !== di) setOverIdx(di); }}
                onDrop={(e) => { e.preventDefault(); onDrop(di); }}
                onDragEnd={resetDrag}
                onClick={() => ed.select(l.id)}
                onContextMenu={(e) => { e.preventDefault(); ed.select(l.id); setMenuOpen(l.id); }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-b border-border px-1.5 py-1 hover:bg-accent/50",
                  isSel && "bg-accent",
                  isOver && "ring-2 ring-inset ring-primary",
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={l.visible ? "Hide" : "Show"}
                  onClick={(e) => { e.stopPropagation(); ed.update(l.id, { visible: !l.visible }); }}
                  className="grid size-6 shrink-0 place-items-center rounded p-0 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  {l.visible ? <Eye className="size-4" /> : <EyeOff className="size-4 opacity-60" />}
                </Button>
                <LayerThumb layer={l} />
                {editing === l.id ? (
                  <Input
                    autoFocus
                    draggable={false}
                    defaultValue={l.name}
                    className="h-6 flex-1 text-xs"
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.stopPropagation()}
                    onBlur={(e) => { ed.update(l.id, { name: e.target.value }); setEditing(null); }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      ed.update(l.id, { name: (e.target as HTMLInputElement).value });
                      setEditing(null);
                    }}
                  />
                ) : (
                  <span
                    className="flex-1 truncate text-xs"
                    onDoubleClick={(e) => { e.stopPropagation(); setEditing(l.id); }}
                  >
                    {l.name}
                  </span>
                )}
                <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-semibold tracking-wide text-muted-foreground">
                  {KIND_LABEL[l.kind]}
                </span>
                {l.mask && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Edit mask"
                    onClick={(e) => { e.stopPropagation(); ed.setMaskEdit(ed.maskEditId === l.id ? null : l.id); }}
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded p-0 font-normal hover:bg-transparent",
                      ed.maskEditId === l.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <SquareDashed className="size-3.5" />
                  </Button>
                )}
                {l.locked && <Lock className="size-3 shrink-0 text-muted-foreground" />}
                <span onClick={(e) => e.stopPropagation()}>
                  <LayerActionsMenu
                    layer={l}
                    onRename={() => setEditing(l.id)}
                    open={menuOpen === l.id}
                    onOpenChange={(o) => setMenuOpen(o ? l.id : null)}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <LayersFooter />
    </div>
  );
}
