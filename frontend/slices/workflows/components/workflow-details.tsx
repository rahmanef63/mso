"use client";

import { Activity, BookOpen, Braces, Clock3, Database, History, SlidersHorizontal } from "lucide-react";
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowInspector } from "./workflow-inspector";
import { WorkflowRunHistory } from "./workflow-run-history";
import { WorkflowRunPanel } from "./workflow-run-panel";
import { WorkflowVariablePanel } from "./workflow-variable-panel";
import { WorkflowVersionPanel } from "./workflow-version-panel";
import { WorkflowDirectoryPanel } from "./workflow-directory-panel";
import { WorkflowDataTablePanel } from "./workflow-data-table-panel";

export type WorkflowPanel = "inspector" | "run" | "history" | "versions" | "variables" | "data" | "directory";

const PANELS = [
  ["inspector", "Builder", SlidersHorizontal],
  ["run", "Current run", Activity],
  ["history", "Executions", History],
  ["versions", "Versions", Clock3],
  ["variables", "Variables", Braces],
  ["data", "Data", Database],
  ["directory", "Directory", BookOpen],
] as const satisfies ReadonlyArray<readonly [WorkflowPanel, string, typeof SlidersHorizontal]>;

export function WorkflowDetails({ graph, graphs, node, run, panel, onPanel, onNode, onDeleteNode, onGraph, onRunSelect, onRestored }: {
  graph: WorkflowGraph;
  graphs: WorkflowGraph[];
  node: WorkflowGraphNode | null;
  run: WorkflowGraphRun | null;
  panel: WorkflowPanel;
  onPanel: (panel: WorkflowPanel) => void;
  onNode: (node: WorkflowGraphNode) => void;
  onDeleteNode: (id: string) => void;
  onGraph: (graph: WorkflowGraph) => void;
  onRunSelect: (run: WorkflowGraphRun) => void;
  onRestored: (graph: WorkflowGraph) => void;
}) {
  return <div className="flex h-full min-h-0 bg-card/20">
    <nav aria-label="Workflow details" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-card/30 p-1.5">
      {PANELS.map(([value, label, Icon]) => <button
        key={value}
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={panel === value}
        className={`grid size-8 place-items-center rounded-md transition ${panel === value ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:bg-accent/55 hover:text-foreground"}`}
        onClick={() => onPanel(value)}
      ><Icon className="size-3.5"/></button>)}
    </nav>
    <div className="min-h-0 min-w-0 flex-1">
      {panel === "inspector" ? <ScrollArea className="h-full"><WorkflowInspector key={node?.id ?? `graph-${graph.id}`} graph={graph} graphs={graphs} node={node} onNode={onNode} onDeleteNode={onDeleteNode} onGraph={onGraph}/></ScrollArea> : null}
      {panel === "run" ? <WorkflowRunPanel run={run}/> : null}
      {panel === "history" ? <WorkflowRunHistory graph={graph} onSelect={onRunSelect}/> : null}
      {panel === "versions" ? <WorkflowVersionPanel graph={graph} onRestored={onRestored}/> : null}
      {panel === "variables" ? <WorkflowVariablePanel/> : null}
      {panel === "data" ? <WorkflowDataTablePanel/> : null}
      {panel === "directory" ? <WorkflowDirectoryPanel/> : null}
    </div>
  </div>;
}
