"use client";

import { useSyncExternalStore } from "react";

export type AlfaProjectContext = {
  id: string;
  name: string;
  path: string;
  branch?: string;
  clean?: boolean;
  head?: string;
  knowledge?: boolean;
  recentMemoryTitles?: string[];
};

const KEY = "alfa.selectedProject";
let selectedProjectId = "";
let projectContext: AlfaProjectContext | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());
const subscribe = (fn: () => void) => { subs.add(fn); return () => subs.delete(fn); };
const getSelected = () => selectedProjectId;
const getContext = () => projectContext;

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

if (typeof window !== "undefined") {
  selectedProjectId = storage()?.getItem(KEY) ?? "";
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    selectedProjectId = storage()?.getItem(KEY) ?? "";
    projectContext = null;
    emit();
  });
}

export function useAlfaSelectedProject(): string {
  return useSyncExternalStore(subscribe, getSelected, () => "");
}

export function alfaSelectedProject(): string { return selectedProjectId; }

export function setAlfaSelectedProject(id: string): void {
  const next = id.trim();
  if (next === selectedProjectId) return;
  selectedProjectId = next;
  projectContext = null;
  try {
    if (next) storage()?.setItem(KEY, next);
    else storage()?.removeItem(KEY);
  } catch { /* in-memory selection still works */ }
  emit();
}

export function useAlfaProjectContext(): AlfaProjectContext | null {
  return useSyncExternalStore(subscribe, getContext, () => null);
}

export function alfaProjectContext(): AlfaProjectContext | null { return projectContext; }

export function setAlfaProjectContext(value: AlfaProjectContext | null): void {
  if (JSON.stringify(value) === JSON.stringify(projectContext)) return;
  projectContext = value;
  emit();
}
