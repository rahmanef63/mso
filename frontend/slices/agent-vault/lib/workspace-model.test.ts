import { describe, expect, it } from "vitest";
import { workspaceDocument } from "./workspace-model";
import type { AgentVaultState } from "@/lib/contracts/agent-vault";
const snapshot={id:"synthetic",capturedAt:"2026-01-01",notes:[{path:"Snapshots/synthetic/Agents/worker.md",title:"Synthetic worker",kind:"agent" as const,source:"generated.md"}],warnings:[],truncated:false};
const state:AgentVaultState={schemaVersion:1,root:"/synthetic/vault",project:{id:"synthetic",name:"Generated",path:"/synthetic/repo"},current:snapshot.id,snapshots:[snapshot],refreshedAt:null};
describe("one knowledge workspace model",()=>{
  it("uses identical IDs, source references and contains edges before/after link hydration",()=>{
    const initial=workspaceDocument(state,snapshot,null);
    const hydrated=workspaceDocument(state,snapshot,{nodes:[{id:"note:Agents/worker",title:"Synthetic worker",kind:"note",group:"Agents",degree:2,path:"/synthetic/vault/Snapshots/synthetic/Agents/worker.md"},{id:"organization:synthetic",title:"Generated unit",kind:"folder",group:"Organization",degree:0,targetApp:"organization"}],edges:[],root:initial.root,counts:{notes:1,memories:0,ghosts:0},warnings:[],truncated:false});
    expect(hydrated.nodes.find(node=>node.note)?.id).toBe(initial.nodes.find(node=>node.note)?.id);
    expect(hydrated.nodes.find(node=>node.note)?.note).toEqual(snapshot.notes[0]);
    expect(hydrated.edges.filter(edge=>edge.kind==="contains")).toEqual(initial.edges);
    expect(hydrated.nodes.some(node=>node.targetApp==="organization")).toBe(true);
    expect(snapshot.notes[0].source).toBe("generated.md");
  });
  it("projects personal note identities once for every presentation without changing snapshots",()=>{
    const document=workspaceDocument(state,snapshot,null,[{name:"synthetic-personal.md",kind:"file",size:10}]);
    expect(document.nodes.find(node=>node.id==="personal:synthetic-personal.md")).toMatchObject({title:"synthetic-personal",path:"/synthetic/vault/Notes/synthetic-personal.md",group:"Personal notes"});
    expect(document.counts.notes).toBe(2);
    expect(document.edges.some(edge=>edge.target==="personal:synthetic-personal.md"&&edge.kind==="contains")).toBe(true);
    expect(snapshot.notes).toHaveLength(1);
  });
  it("keeps empty state and partial projection explicit without inventing records",()=>{
    expect(workspaceDocument(null,undefined,null).nodes).toEqual([]);
    expect(workspaceDocument(state,{...snapshot,truncated:true},null).truncated).toBe(true);
  });
});
