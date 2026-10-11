"use client";
import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { openWindow, useIntentPrefetch } from "@/features/appshell";
import { useSession } from "@/features/auth";
import { useWorkspace } from "../lib/use-workspace";
import type { WorkspaceView, WorkspaceNode } from "../lib/workspace-model";
import type { WorkspaceGraphProps } from "../memory/components/memory-graph-screen";
import { VaultScreen } from "./vault-screen";

const graphView = {load: () => import("../memory/components/memory-graph-screen")};
const sourceEditor = {load: () => import("../organization/components/organization-view")};

export function WorkspaceScreen({initialView="vault", project, root}: {initialView?: WorkspaceView; project?: string; root?: string}) {
  const workspace = useWorkspace(project, root), {vault, document, loadGraph, loadPersonal} = workspace;
  const {status, role} = useSession();
  const [mobileReader, setMobileReader] = useState(false), [personal,setPersonal]=useState(false);
  const [view, setView] = useState(initialView), [selected, setSelected] = useState<string | null>(null);
  const [GraphView, setGraphView] = useState<ComponentType<WorkspaceGraphProps> | null>(null);
  const [Editor, setEditor] = useState<ComponentType<{onClose?:()=>void}> | null>(null), [editing, setEditing] = useState(false);
  const prefetch = useIntentPrefetch(status === "in" && role === "owner" && !editing);
  const [viewError, setViewError] = useState("");
  useEffect(() => {
    if (view === "vault" || status !== "in" || role !== "owner") return;
    loadGraph(); void loadPersonal();
    if (!GraphView) void graphView.load().then(module=>setGraphView(()=>module.MemoryGraphScreen)).catch(()=>setViewError("Could not open this view. Reload to retry."));
  }, [view, status, role, loadGraph, loadPersonal, GraphView]);
  const openNode = (node: WorkspaceNode) => {
    if (node.note) { setPersonal(false); setMobileReader(true); void vault.select(node.note.path); setView("vault"); return; }
    if (node.targetApp === "organization") { openEditor(); return; }
    if (node.targetApp === "workflows") { openWindow("workflows", "Workflows", undefined, {view:"sources"}); return; }
    if (node.path) openWindow("code-editor", node.title, undefined, {path:node.path});
  };
  function openEditor() {
    setEditing(true);
    if (!Editor) void sourceEditor.load().then(module=>setEditor(()=>module.OrganizationView)).catch(()=>setViewError("Could not open the source editor. Reload to retry."));
  }
  if (status !== "in" || role !== "owner") return <p className="p-4 text-sm text-muted-foreground">Owner access is required to open private repository notes.</p>;
  return <div data-slot="knowledge-workspace" data-snapshot={vault.snapshotId} data-model-root={document.root??""} className="flex h-full min-h-0 flex-col">
    {!editing ? <nav aria-label="Knowledge views" className="flex shrink-0 items-center gap-1 border-b px-3 py-1 [@media(max-height:520px)]:py-0">
      {(["vault","memory","organization"] as const).map(mode=><Button key={mode} size="sm" className="[@media(max-height:520px)]:h-6" variant={view===mode?"secondary":"ghost"} aria-pressed={view===mode} onPointerEnter={event=>{if(mode!=="vault")prefetch.schedule(graphView,event.pointerType);}} onPointerLeave={prefetch.cancel} onFocus={()=>{if(mode!=="vault")prefetch.schedule(graphView,"keyboard");}} onBlur={prefetch.cancel} onClick={()=>setView(mode)}>{mode==="vault"?"Vault":mode==="memory"?"Memory":"Organization"}</Button>)}
      {view==="organization" ? <Button className="ml-auto" size="sm" variant="outline" onPointerEnter={event=>prefetch.schedule(sourceEditor,event.pointerType)} onPointerLeave={prefetch.cancel} onFocus={()=>prefetch.schedule(sourceEditor,"keyboard")} onBlur={prefetch.cancel} onClick={openEditor}>Edit organization</Button> : null}
    </nav> : null}
    {viewError ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{viewError}</p> : null}
    <div className={`${view==="vault"&&!editing?"flex":"hidden"} min-h-0 flex-1 flex-col`}><VaultScreen workspace={workspace} active={view==="vault"&&!editing} mobileReader={mobileReader} setMobileReader={setMobileReader} personal={personal} setPersonal={setPersonal}/></div>
    {editing ? <div className="min-h-0 flex-1">{Editor?<Editor onClose={()=>{setEditing(false);workspace.reloadGraph();}}/>:<div className="p-4"><Button variant="ghost" onClick={()=>setEditing(false)}>Back to structure</Button><p role="status">Loading source editor…</p></div>}</div> : view!=="vault" ? <div className="min-h-0 flex-1">{GraphView?<GraphView key={view} graph={document} busy={workspace.graphBusy} error={workspace.graphError||workspace.personalError} organization={view==="organization"} selected={selected} onSelect={setSelected} onOpen={openNode} onReload={()=>{workspace.reloadGraph();void loadPersonal(true);}}/>:<p role="status" className="p-4">Loading view…</p>}</div> : null}
  </div>;
}
