"use client";

import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowInspector } from "./workflow-inspector";
import { WorkflowRunHistory } from "./workflow-run-history";
import { WorkflowRunPanel } from "./workflow-run-panel";
import { WorkflowVariablePanel } from "./workflow-variable-panel";
import { WorkflowVersionPanel } from "./workflow-version-panel";
import { WorkflowDirectoryPanel } from "./workflow-directory-panel";

export type WorkflowPanel = "inspector" | "run" | "history" | "versions" | "variables" | "directory";

const LABELS: Array<[WorkflowPanel, string]> = [["inspector", "Inspector"], ["run", "Run"], ["history", "History"], ["versions", "Versions"], ["variables", "Vars"], ["directory", "Directory"]];

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
  return <div className="flex h-full min-h-0 flex-col bg-card/20">
    <div className="flex h-10 shrink-0 overflow-x-auto border-b">{LABELS.map(([value, label]) => <button key={value} type="button" className={`min-w-14 flex-1 px-1 text-[10px] ${panel === value ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onPanel(value)}>{label}</button>)}</div>
    <div className="min-h-0 flex-1">{panel === "inspector" ? <ScrollArea className="h-full"><WorkflowInspector key={node?.id ?? `graph-${graph.id}`} graph={graph} graphs={graphs} node={node} onNode={onNode} onDeleteNode={onDeleteNode} onGraph={onGraph}/></ScrollArea> : null}{panel === "run" ? <WorkflowRunPanel run={run}/> : null}{panel === "history" ? <WorkflowRunHistory graph={graph} onSelect={onRunSelect}/> : null}{panel === "versions" ? <WorkflowVersionPanel graph={graph} onRestored={onRestored}/> : null}{panel === "variables" ? <WorkflowVariablePanel/> : null}{panel === "directory" ? <WorkflowDirectoryPanel/> : null}</div>
  </div>;
}
