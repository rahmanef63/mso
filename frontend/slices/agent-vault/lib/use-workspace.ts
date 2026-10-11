"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FsEntry, FsList } from "@/lib/contracts/os-api";
import type { MemoryGraphDocument } from "@/lib/memory-graph/types";
import { workspaceDocument } from "./workspace-model";
import { useVault } from "./use-vault";

export function useWorkspace(project?: string, root?: string) {
  const vault = useVault(project, root);
  const snapshot = vault.state?.snapshots.find(item => item.id === vault.snapshotId);
  const graphRoot = vault.state && snapshot ? `${vault.state.root}/Snapshots/${snapshot.id}` : root ?? "";
  const graphProject = vault.state?.project.path ?? project ?? "";
  const directory = vault.state ? `${vault.state.root}/Notes` : "";
  const [personal, setPersonal] = useState<{directory:string; entries:FsEntry[]; error:string} | null>(null);
  const personalRequest = useRef<AbortController | null>(null);
  const loadPersonal = useCallback(async (force=false) => {
    if (!directory || (!force && personal?.directory===directory)) return;
    personalRequest.current?.abort(); const controller=new AbortController(); personalRequest.current=controller;
    try {
      const response=await fetch(`/api/v1/fs/list?${new URLSearchParams({path:directory})}`,{cache:"no-store",signal:controller.signal});
      const result=await response.json();
      if (!response.ok && response.status!==404) throw new Error(result.error||"Could not read personal notes");
      if (!controller.signal.aborted) setPersonal({directory,entries:response.status===404?[]:(result as FsList).entries.filter(entry=>entry.kind==="file"&&entry.name.endsWith(".md")),error:""});
    } catch(cause) { if(!controller.signal.aborted) setPersonal({directory,entries:[],error:cause instanceof Error?cause.message:"Could not read personal notes"}); }
  },[directory,personal?.directory]);
  useEffect(()=>()=>{personalRequest.current?.abort();},[directory]);
  const entries=personal?.directory===directory?personal.entries:undefined;
  const personalError=personal?.directory===directory?personal.error:"";
  const [nonce, setNonce] = useState(0);
  const key = `${graphRoot}\n${graphProject}\n${nonce}`;
  const [result, setResult] = useState<{ key: string; graph: MemoryGraphDocument | null; error: string } | null>(null);
  const request = useRef<{key: string; controller: AbortController} | null>(null);
  const graph = result?.key === key ? result.graph : null;
  const error = result?.key === key ? result.error : "";
  const loadGraph = useCallback(() => {
    if (vault.busy || result?.key === key || request.current?.key === key) return;
    request.current?.controller.abort();
    const controller = new AbortController(); request.current = {key, controller};
    void fetch(`/api/v1/memory-graph?${new URLSearchParams({root:graphRoot, project:graphProject})}`, {cache:"no-store", signal:controller.signal}).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not load workspace connections");
      if (!controller.signal.aborted) setResult({key, graph:body, error:""});
    }).catch(cause => { if (!controller.signal.aborted) setResult({key, graph:null, error:cause instanceof Error ? cause.message : "Could not load workspace connections"}); });
  }, [graphRoot, graphProject, key, result?.key, vault.busy]);
  useEffect(() => () => { request.current?.controller.abort(); request.current = null; }, [key]);
  const document = useMemo(() => workspaceDocument(vault.state, snapshot, graph, entries), [vault.state, snapshot, graph, entries]);
  return {vault, document, personalError, loadPersonal, graph, graphError:error, graphBusy:result?.key !== key, loadGraph, reloadGraph:()=>setNonce(value=>value+1)};
}
