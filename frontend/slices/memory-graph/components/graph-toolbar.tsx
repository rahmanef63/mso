"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupColor, type GraphLayoutName } from "../lib/layout";

const LAYOUTS: GraphLayoutName[] = ["web", "radial", "layered"];

export function GraphToolbar({
  root, project, layout, local, depth, showGhosts, showTags, showOrphans, groups, hiddenGroups, busy,
  onRoot, onProject, onLayout, onLocal, onDepth, onGhosts, onTags, onOrphans, onToggleGroup, onReload,
}: {
  root: string;
  project: string;
  layout: GraphLayoutName;
  local: boolean;
  depth: number;
  showGhosts: boolean;
  showTags: boolean;
  showOrphans: boolean;
  groups: string[];
  hiddenGroups: string[];
  busy: boolean;
  onRoot: (value: string) => void;
  onProject: (value: string) => void;
  onLayout: (value: GraphLayoutName) => void;
  onLocal: (value: boolean) => void;
  onDepth: (value: number) => void;
  onGhosts: (value: boolean) => void;
  onTags: (value: boolean) => void;
  onOrphans: (value: boolean) => void;
  onToggleGroup: (group: string) => void;
  onReload: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Input aria-label="Vault path" value={root} placeholder="Vault path (optional)" onChange={(event) => onRoot(event.target.value)} className="h-8 w-40 text-xs" />
      <Input aria-label="Project" value={project} placeholder="Project" onChange={(event) => onProject(event.target.value)} className="h-8 w-28 text-xs" />
      <Button size="sm" variant="outline" disabled={busy} onClick={onReload}>Load</Button>
      {LAYOUTS.map((name) => (
        <Button key={name} size="sm" variant={layout === name ? "default" : "outline"} onClick={() => onLayout(name)} className="capitalize">{name}</Button>
      ))}
      <Button size="sm" variant={local ? "default" : "outline"} onClick={() => onLocal(!local)}>Local</Button>
      {local ? (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Hops
          <Input aria-label="Neighbourhood hops" type="number" min={1} max={4} value={depth} onChange={(event) => onDepth(Number(event.target.value) || 1)} className="h-8 w-14 text-xs" />
        </label>
      ) : null}
      <Toggle label="Ghosts" checked={showGhosts} onChange={onGhosts} />
      <Toggle label="Tags" checked={showTags} onChange={onTags} />
      <Toggle label="Orphans" checked={showOrphans} onChange={onOrphans} />
      {groups.slice(0, 12).map((group) => (
        <button key={group} type="button" className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground" style={{ borderColor: groupColor(group, groups) }} aria-pressed={!hiddenGroups.includes(group)} onClick={() => onToggleGroup(group)}>
          {group}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
