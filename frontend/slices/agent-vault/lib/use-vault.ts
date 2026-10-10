"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentVaultState, AgentVaultView } from "@/lib/contracts/agent-vault";

const KEY = "mso:agent-vault:project";
export async function vaultRequest(project: string, signal: AbortSignal, sync = false, note?: string): Promise<AgentVaultView> {
  const params = new URLSearchParams();
  if (project.trim()) params.set("project", project.trim());
  if (note) params.set("note", note);
  const response = await fetch(`/api/v1/agent-vault?${params}`, sync ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project.trim() ? { project: project.trim() } : {}), signal,
  } : { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as AgentVaultView;
}

export function useVault() {
  const [project, setProject] = useState("");
  const [state, setState] = useState<AgentVaultState | null>(null);
  const [snapshotId, setSnapshotId] = useState("");
  const [note, setNote] = useState<AgentVaultView["note"]>();
  const [selectedPath, setSelectedPath] = useState("");
  const [busy, setBusy] = useState(true), [noteBusy, setNoteBusy] = useState(false), [error, setError] = useState("");
  const loading = useRef<AbortController | null>(null), reading = useRef<AbortController | null>(null);

  const apply = useCallback((result: AgentVaultView) => {
    setState(result.state); setSnapshotId(result.state.current || "");
    setProject(result.state.project.path); localStorage.setItem(KEY, result.state.project.path);
  }, []);

  const load = useCallback(async (hint: string, sync = false) => {
    loading.current?.abort(); reading.current?.abort();
    const controller = new AbortController(); loading.current = controller;
    setBusy(true); setError(""); setNote(undefined); setSelectedPath(""); setNoteBusy(false);
    try {
      const result = await vaultRequest(hint, controller.signal, sync);
      if (controller.signal.aborted) return;
      apply(result);
    } catch (cause) {
      if (!controller.signal.aborted) { setState(null); setError(cause instanceof Error ? cause.message : "Could not load vault"); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }, [apply]);

  useEffect(() => {
    const controller = new AbortController(); loading.current = controller;
    void vaultRequest(localStorage.getItem(KEY) || "", controller.signal).then(result => {
      if (!controller.signal.aborted) apply(result);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load vault");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); loading.current?.abort(); reading.current?.abort(); };
  }, [apply]);

  const select = useCallback(async (path: string) => {
    if (!state || busy) return;
    reading.current?.abort();
    const controller = new AbortController(); reading.current = controller;
    setSelectedPath(path); setNoteBusy(true); setError(""); setNote(undefined);
    try {
      const result = await vaultRequest(state.project.path, controller.signal, false, path);
      if (!controller.signal.aborted) setNote(result.note);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read note");
    } finally { if (!controller.signal.aborted) setNoteBusy(false); }
  }, [state, busy]);

  function chooseSnapshot(id: string) {
    reading.current?.abort(); setSnapshotId(id); setNote(undefined); setSelectedPath(""); setNoteBusy(false); setError("");
  }
  return { project, setProject, state, snapshotId, chooseSnapshot, note, selectedPath, busy, noteBusy, error, load, select };
}
