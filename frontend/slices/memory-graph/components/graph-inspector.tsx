"use client";

import { Button } from "@/components/ui/button";
import type { MemoryGraphNode } from "@/lib/memory-graph/types";

export function GraphInspector({ node, onOpen }: { node: MemoryGraphNode | null; onOpen: (node: MemoryGraphNode) => void }) {
  if (!node) {
    return <aside className="p-3 text-xs text-muted-foreground">Select a node. Double-click a note to open it.</aside>;
  }
  return (
    <aside className="flex flex-col gap-2 overflow-auto p-3">
      <h2 className="text-sm font-medium">{node.title}</h2>
      <p className="text-xs text-muted-foreground">{node.kind} · {node.group} · {node.degree} links</p>
      {node.kind === "ghost" ? <p className="text-xs">Unresolved wikilink. No note in this graph uses that title.</p> : null}
      {node.excerpt ? <p className="text-xs leading-relaxed">{node.excerpt}</p> : null}
      {node.origin ? <p className="break-all text-[10px] text-muted-foreground">Source: {node.origin}</p> : null}
      {node.path || node.targetApp ? <Button size="sm" onClick={() => onOpen(node)}>{node.targetApp ? "Open source app" : "Open"}</Button> : null}
    </aside>
  );
}
