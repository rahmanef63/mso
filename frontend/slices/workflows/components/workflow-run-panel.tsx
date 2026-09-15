"use client";
import type { WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { ScrollArea } from "@/components/ui/scroll-area";

export function WorkflowRunPanel({ run }: { run: WorkflowGraphRun | null }) {
  if (!run) return <div className="p-4 text-xs text-muted-foreground">Run a workflow to inspect node-by-node receipts.</div>;
  return <ScrollArea className="h-full"><div className="space-y-2 p-3">
    <div className="rounded-lg border p-3 text-xs"><div className="font-semibold">{run.graphName}</div><div className="mt-1 text-muted-foreground">{run.state}{run.failedNodeName ? ` · failed at ${run.failedNodeName}` : ""}</div></div>
    {run.nodes.map((node) => <details key={node.id} className="rounded-lg border p-2" open={node.state === "failed"}>
      <summary className="cursor-pointer text-xs font-medium">{node.name} <span className="text-muted-foreground">· {node.state}{node.durationMs != null ? ` · ${node.durationMs}ms` : ""}</span></summary>
      <div className="mt-2 space-y-1 font-mono text-[10px] text-muted-foreground">{node.logs.map((log, i) => <div key={i}>{log}</div>)}{node.error && <div>{node.error}</div>}{node.output !== undefined && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{JSON.stringify(node.output, null, 2)}</pre>}</div>
    </details>)}
  </div></ScrollArea>;
}
