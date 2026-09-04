"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CockpitProjectRow, CockpitSelectedProject } from "../lib/cockpit-types";

export function ProjectQuickSelect({
  rows, selected, value, onChange,
}: {
  rows: CockpitProjectRow[];
  selected: CockpitSelectedProject | null;
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchRows, setSearchRows] = useState<CockpitProjectRow[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/v1/alfa/cockpit?q=${encodeURIComponent(q)}`, { cache: "no-store", signal: ctrl.signal })
        .then((response) => response.ok ? response.json() : { projects: { rows: [] } })
        .then((body) => setSearchRows((body.projects?.rows ?? []) as CockpitProjectRow[]))
        .catch(() => undefined);
    }, 250);
    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [query]);

  const options = useMemo(() => {
    const base = query.trim() ? searchRows : rows;
    if (!selected || base.some((row) => row.id === selected.project.id)) return base;
    return [{ id: selected.project.id, name: selected.project.name, path: selected.project.path }, ...base];
  }, [query, rows, searchRows, selected]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects on this host" className="h-9 pl-8 text-xs" />
      </div>
      <Select value={value || "__none"} onValueChange={(next) => onChange(next === "__none" ? "" : next)}>
        <SelectTrigger className="w-full"><SelectValue placeholder="Select project" /></SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="__none">No project</SelectItem>
          {options.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
