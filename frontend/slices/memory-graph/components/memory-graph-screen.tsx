"use client";

import { useEffect, useMemo, useState } from "react";
import { openWindow } from "@/features/appshell";
import type { MemoryGraphDocument, MemoryGraphNode } from "@/lib/memory-graph/types";
import { GraphCanvas } from "./graph-canvas";
import { GraphInspector } from "./graph-inspector";
import { GraphToolbar } from "./graph-toolbar";
import type { GraphLayoutName } from "../lib/layout";
import { viewGraph } from "../lib/view-model";

const ROOT_KEY = "mso:memory-graph:root";
const PROJECT_KEY = "mso:memory-graph:project";

function stored(key: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) ?? "";
}

async function loadGraph(root: string, project: string): Promise<MemoryGraphDocument> {
  const params = new URLSearchParams();
  if (root.trim()) params.set("root", root.trim());
  if (project.trim()) params.set("project", project.trim());
  const response = await fetch(`/api/v1/memory-graph?${params}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `request failed (${response.status})`);
  return body as MemoryGraphDocument;
}

export function MemoryGraphScreen() {
  const [root, setRoot] = useState(() => stored(ROOT_KEY));
  const [project, setProject] = useState(() => stored(PROJECT_KEY));
  const [applied, setApplied] = useState(() => ({ root: stored(ROOT_KEY), project: stored(PROJECT_KEY), nonce: 0 }));
  const [layout, setLayout] = useState<GraphLayoutName>("web");
  const [local, setLocal] = useState(false);
  const [depth, setDepth] = useState(2);
  const [showGhosts, setShowGhosts] = useState(true);
  const [showTags, setShowTags] = useState(false);
  const [showOrphans, setShowOrphans] = useState(true);
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; graph: MemoryGraphDocument | null; error: string } | null>(null);
  const requestKey = `${applied.root}\n${applied.project}\n${applied.nonce}`;
  const graph = result?.key === requestKey ? result.graph : null;
  const error = result?.key === requestKey ? result.error : "";
  const busy = result?.key !== requestKey;

  useEffect(() => {
    const key = requestKey;
    let alive = true;
    loadGraph(applied.root, applied.project).then(
      (next) => { if (alive) setResult({ key, graph: next, error: "" }); },
      (cause: unknown) => { if (alive) setResult({ key, graph: null, error: cause instanceof Error ? cause.message : "Could not load the memory graph" }); },
    );
    return () => { alive = false; };
  }, [applied.project, applied.root, requestKey]);

  const visible = useMemo(() => graph ? viewGraph(graph, {
    query, showGhosts, showTags, showOrphans, local, depth: Math.min(4, Math.max(1, depth)), focusId: selected, hiddenGroups,
  }) : null, [graph, query, showGhosts, showTags, showOrphans, local, depth, selected, hiddenGroups]);
  const groups = useMemo(() => [...new Set(graph?.nodes.map((node) => node.group) ?? [])], [graph]);
  const current = visible?.nodes.find((node) => node.id === selected) ?? null;

  const openNode = (node: MemoryGraphNode) => {
    if (!node.path) return;
    openWindow("code-editor", node.title, { w: 860, h: 600 }, { path: node.path });
  };
  const selectNode = (id: string) => {
    if (id === selected) {
      const node = visible?.nodes.find((item) => item.id === id);
      if (node) openNode(node);
    }
    setSelected(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GraphToolbar
        root={root} project={project} layout={layout} local={local} depth={depth}
        showGhosts={showGhosts} showTags={showTags} showOrphans={showOrphans}
        groups={groups} hiddenGroups={hiddenGroups} busy={busy}
        onRoot={setRoot} onProject={setProject} onLayout={setLayout} onLocal={setLocal} onDepth={setDepth}
        onGhosts={setShowGhosts} onTags={setShowTags} onOrphans={setShowOrphans}
        onToggleGroup={(group) => setHiddenGroups((currentGroups) => currentGroups.includes(group) ? currentGroups.filter((item) => item !== group) : [...currentGroups, group])}
        onReload={() => {
          localStorage.setItem(ROOT_KEY, root);
          localStorage.setItem(PROJECT_KEY, project);
          setApplied({ root, project, nonce: applied.nonce + 1 });
        }}
      />
      <div className="flex items-center gap-2 border-b px-3 py-1">
        <input aria-label="Search graph" value={query} placeholder="Search titles" onChange={(event) => setQuery(event.target.value)} className="h-7 w-full bg-transparent text-xs outline-none" />
        <span className="shrink-0 text-[11px] text-muted-foreground">{busy ? "Loading" : `${visible?.nodes.length ?? 0} nodes`}</span>
      </div>
      {error ? <p className="px-3 py-2 text-xs text-destructive">{error}</p> : null}
      {graph?.warnings.length ? <p className="px-3 py-1 text-xs text-muted-foreground">{graph.warnings.join(" · ")}</p> : null}
      {!error && graph && visible && visible.nodes.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No notes yet. Set a markdown vault inside your read roots, or add project knowledge and agent memory. Optional default: OS_MEMORY_GRAPH_ROOT.</p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col @min-[560px]:flex-row">
        <div className="min-h-0 min-w-0 flex-1">
          {visible ? <GraphCanvas nodes={visible.nodes} edges={visible.edges} layout={layout} selected={selected} onSelect={selectNode} onOpen={openNode} /> : null}
        </div>
        <div className="max-h-40 shrink-0 overflow-auto border-t @min-[560px]:max-h-none @min-[560px]:w-64 @min-[560px]:border-t-0 @min-[560px]:border-l">
          <GraphInspector node={current} onOpen={openNode} />
        </div>
      </div>
    </div>
  );
}
