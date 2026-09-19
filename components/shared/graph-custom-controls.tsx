"use client";
import { useState } from "react";
import { Boxes, ChevronDown, ChevronUp, Ungroup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/features/appshell";
import type { GraphCustomNode } from "@/lib/contracts/graph-custom-nodes";

type Props = { groups: GraphCustomNode[]; selectedIds: string[]; nodeIds: string[]; onChange: (groups: GraphCustomNode[]) => void; disabled?: boolean };
/** Shared selection action; grouping is presentation metadata, never an execution rewrite. */
export function GraphCustomControls({ groups, selectedIds, nodeIds, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [managedId, setManagedId] = useState("");
  const members = selectedIds.filter((id) => nodeIds.includes(id));
  const occupied = members.some((id) => groups.some((group) => group.nodeIds.includes(id)));
  const selectedGroup = groups.find((group) => selectedIds.includes(group.id)) ?? groups.find((group) => group.id === managedId);
  const create = () => { if (!members.length || occupied || !name.trim()) return; onChange([...groups, { id: `custom-${crypto.randomUUID()}`, name: name.trim(), nodeIds: members, collapsed: true }]); setOpen(false); setName(""); };
  return <div data-slot="graph-custom-controls" className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
    <span className="text-xs text-muted-foreground" aria-live="polite">{selectedIds.length} selected</span>
    <Button size="sm" variant="outline" disabled={disabled || !members.length || occupied} title={occupied ? "Ungroup existing members before creating another custom node" : "Select one or more nodes, then create a named custom node"} onClick={() => setOpen(true)}><Boxes className="mr-1 size-3.5"/>Create custom node</Button>
    {groups.length ? <><select aria-label="Custom node" className="h-8 min-w-0 max-w-48 rounded-md border bg-background px-2 text-xs" value={selectedGroup?.id ?? ""} onChange={(event) => setManagedId(event.target.value)}><option value="">Manage custom node…</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.nodeIds.length})</option>)}</select>{selectedGroup ? <><Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange(groups.map((group) => group.id === selectedGroup.id ? { ...group, collapsed: !group.collapsed } : group))}>{selectedGroup.collapsed ? <ChevronDown className="mr-1 size-3.5"/> : <ChevronUp className="mr-1 size-3.5"/>}{selectedGroup.collapsed ? "Expand" : "Collapse"}</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={() => { onChange(groups.filter((group) => group.id !== selectedGroup.id)); setManagedId(""); }}><Ungroup className="mr-1 size-3.5"/>Ungroup</Button></> : null}</> : null}
    <ResponsiveDialog open={open} onOpenChange={setOpen} size="md" mobileVariant="drawer-bottom"><ResponsiveDialog.Header><ResponsiveDialog.Title>Create custom node</ResponsiveDialog.Title><ResponsiveDialog.Description>Group {members.length} selected node(s). Original nodes, ports, configuration and execution remain unchanged. Expand to edit or connect individual members.</ResponsiveDialog.Description></ResponsiveDialog.Header><ResponsiveDialog.Body><label className="grid gap-2 text-sm">Custom node name<Input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") create(); }}/></label></ResponsiveDialog.Body><ResponsiveDialog.Footer><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={disabled || !members.length || occupied || !name.trim()} onClick={create}>Create</Button></ResponsiveDialog.Footer></ResponsiveDialog>
  </div>;
}
