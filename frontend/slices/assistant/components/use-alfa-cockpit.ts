"use client";

import { useCallback, useEffect, useState } from "react";
import {
  setAlfaProjectContext,
  setAlfaSelectedProject,
  useAlfaSelectedProject,
} from "@/features/appshell";
import type { AlfaCockpitData } from "../lib/cockpit-types";

function publishProjectContext(data: AlfaCockpitData | null) {
  const selected = data?.selectedProject;
  if (!selected) {
    setAlfaProjectContext(null);
    return;
  }
  setAlfaProjectContext({
    id: selected.project.id,
    name: selected.project.name,
    path: selected.project.path,
    branch: selected.git.branch,
    clean: selected.git.clean,
    head: selected.git.head?.sha,
    knowledge: selected.knowledge?.exists === true,
    recentMemoryTitles: (selected.recentMemory ?? []).map((row) => row.title).slice(0, 6),
  });
}

export function useAlfaCockpit() {
  const selectedProjectId = useAlfaSelectedProject();
  const [data, setData] = useState<AlfaCockpitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const query = selectedProjectId ? `?project=${encodeURIComponent(selectedProjectId)}` : "";
    fetch(`/api/v1/alfa/cockpit${query}`, { cache: "no-store", signal: ctrl.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
        return body as AlfaCockpitData;
      })
      .then((next) => {
        setData(next);
        setError(null);
        publishProjectContext(next);
      })
      .catch((reason) => {
        if (ctrl.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Failed to load Alfa cockpit");
        publishProjectContext(null);
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [selectedProjectId, reloadKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);
  const selectProject = useCallback((id: string) => {
    setLoading(true);
    setAlfaSelectedProject(id);
  }, []);

  return { data, loading, error, selectedProjectId, selectProject, refresh };
}
