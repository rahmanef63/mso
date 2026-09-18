"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveDialog } from "@/features/appshell";
import { ORGANIZATION_FLOW_KINDS, ORGANIZATION_FLOW_STATUSES, type OrganizationFlowAction, type OrganizationFlowEdge, type OrganizationFlowNode, type OrganizationProjectFlow } from "@/lib/contracts/organization-flow";

export type FlowDraft = { kind: "node"; node?: OrganizationFlowNode } | { kind: "edge"; edge?: OrganizationFlowEdge } | { kind: "notes" };
type Props = { draft: FlowDraft | null; flow: OrganizationProjectFlow; onClose: () => void; onSave: (action: OrganizationFlowAction, data: Record<string, unknown>) => Promise<void> };
const selectClass = "h-10 w-full rounded-md border bg-background px-2 text-sm";
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="grid gap-1.5 text-xs"><span className="text-muted-foreground">{label}</span>{children}</label>;
export function ProjectFlowEditor(props: Props) {
  return <ResponsiveDialog open={!!props.draft} onOpenChange={(open) => !open && props.onClose()} size="lg" mobileVariant="drawer-bottom"><EditorBody key={props.draft ? JSON.stringify(props.draft) : "closed"} {...props}/></ResponsiveDialog>;
}
function EditorBody({ draft, flow, onClose, onSave }: Props) {
  const item = draft?.kind === "node" ? draft.node : draft?.kind === "edge" ? draft.edge : undefined;
  const [form, setForm] = useState<Record<string, string>>((): Record<string, string> => draft?.kind === "notes" ? { title: flow.title, notes: flow.notes }
    : draft?.kind === "edge" ? { source: draft.edge?.source ?? flow.nodes[0]?.id ?? "", target: draft.edge?.target ?? flow.nodes[1]?.id ?? "", label: draft.edge?.label ?? "" }
    : { title: draft?.node?.title ?? "", kind: draft?.node?.kind ?? "project", status: draft?.node?.status ?? "unconfirmed", summary: draft?.node?.summary ?? "", notes: draft?.node?.notes ?? "", projectRef: draft?.node?.projectRef ?? "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmDelete, setConfirmDelete] = useState(false);
  if (!draft) return null;
  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const run = async (remove = false) => {
    setBusy(true); setError("");
    try {
      if (remove && item) await onSave(draft.kind === "node" ? "flow_node_delete" : "flow_edge_delete", { id: item.id });
      else if (draft.kind === "notes") await onSave("flow_update", form);
      else if (draft.kind === "edge") await onSave("flow_edge_upsert", { edge: { ...item, ...form } });
      else await onSave("flow_node_upsert", { node: { position: { x: (flow.nodes.length % 4) * 300, y: Math.floor(flow.nodes.length / 4) * 200 }, ...item, ...form } });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed"); }
    finally { setBusy(false); }
  };
  const title = draft.kind === "notes" ? "Flow notes" : `${item ? "Edit" : "New"} ${draft.kind}`;
  return <>
    <ResponsiveDialog.Header><ResponsiveDialog.Title>{title}</ResponsiveDialog.Title><ResponsiveDialog.Description>Saved inside this organization. Context and references only; no automatic execution.</ResponsiveDialog.Description></ResponsiveDialog.Header>
    <ResponsiveDialog.Body><div className="grid gap-4 py-1">
      {draft.kind === "edge" ? <><Field label="From node"><select aria-label="From node" className={selectClass} value={form.source} onChange={(e) => set("source", e.target.value)}>{flow.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></Field><Field label="To node"><select aria-label="To node" className={selectClass} value={form.target} onChange={(e) => set("target", e.target.value)}>{flow.nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></Field><Field label="Relationship"><Input maxLength={160} value={form.label} onChange={(e) => set("label", e.target.value)}/></Field></> : <>
        <Field label={draft.kind === "notes" ? "Flow title" : "Node title"}><Input maxLength={draft.kind === "notes" ? 160 : 120} value={form.title} onChange={(e) => set("title", e.target.value)}/></Field>
        {draft.kind === "node" ? <><div className="grid grid-cols-2 gap-3"><Field label="Node kind"><select aria-label="Node kind" className={selectClass} value={form.kind} onChange={(e) => set("kind", e.target.value)}>{ORGANIZATION_FLOW_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></Field><Field label="Status"><select aria-label="Status" className={selectClass} value={form.status} onChange={(e) => set("status", e.target.value)}>{ORGANIZATION_FLOW_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field></div><Field label="Summary"><Textarea maxLength={500} value={form.summary} onChange={(e) => set("summary", e.target.value)}/></Field><Field label="Project reference (optional)"><Input maxLength={4096} value={form.projectRef} onChange={(e) => set("projectRef", e.target.value)} placeholder="Canonical project identifier; not an execution command"/></Field></> : null}
        <Field label="Notes"><Textarea className="min-h-52 text-sm" maxLength={draft.kind === "notes" ? 64000 : 12000} value={form.notes} onChange={(e) => set("notes", e.target.value)}/></Field>
      </>}
      {error ? <p role="alert" className="text-sm text-destructive">{error} Your text is kept here; copy it before refreshing after a revision conflict.</p> : null}
      {confirmDelete ? <p role="alert" className="text-sm text-destructive">Delete this {draft.kind}? Deleting a node also removes its connections. This cannot be undone here.</p> : null}
    </div></ResponsiveDialog.Body>
    <ResponsiveDialog.Footer><div className="flex w-full flex-wrap gap-2">
      {item ? <Button variant="destructive" disabled={busy} onClick={() => confirmDelete ? void run(true) : setConfirmDelete(true)}>{confirmDelete ? "Confirm delete" : "Delete"}</Button> : null}
      <div className="flex-1"/><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void run()}>{busy ? "Saving…" : "Save"}</Button>
    </div></ResponsiveDialog.Footer>
  </>;
}
