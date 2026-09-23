"use client";

import { useMemo, useState } from "react";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormDrawer, openWindow } from "@/features/appshell";
import { channelAction } from "../lib/api";
import type { ChannelsSnapshot, ChannelProviderId, ChannelView, WorkflowOption } from "../types";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const credentialValue = (user: string, connection: string) => `${user}::${connection}`;

export function ChannelEditor({
  open,
  onOpenChange,
  row,
  snapshot,
  workflows,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  row: ChannelView | null;
  snapshot: ChannelsSnapshot;
  workflows: WorkflowOption[];
  onSaved: () => Promise<void>;
}) {
  const initialProvider = row?.provider ?? "telegram";
  const initialCredential = row
    ? credentialValue(row.credential.user, row.credential.connection)
    : (() => {
        const first = snapshot.credentials.find((item) => item.provider === initialProvider);
        return first ? credentialValue(first.user, first.id) : "";
      })();

  const [name, setName] = useState(row?.name ?? "");
  const [provider, setProvider] = useState<ChannelProviderId>(initialProvider);
  const [credential, setCredential] = useState(initialCredential);
  const [target, setTarget] = useState(row?.defaultTarget ?? "");
  const [workflowId, setWorkflowId] = useState(row?.workflowId ?? "");
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const credentials = useMemo(
    () => snapshot.credentials.filter((item) => item.provider === provider),
    [provider, snapshot.credentials],
  );

  const changeProvider = (next: ChannelProviderId) => {
    setProvider(next);
    const first = snapshot.credentials.find((item) => item.provider === next);
    setCredential(first ? credentialValue(first.user, first.id) : "");
  };

  const save = async () => {
    const [user, connection] = credential.split("::");
    if (!user || !connection) { setError("Choose an Integration connection first."); return; }
    setBusy(true); setError("");
    try {
      const data = {
        name,
        provider,
        credential: { user, connection },
        enabled,
        defaultTarget: target,
        workflowId,
      };
      await channelAction(row
        ? { action: "update", id: row.id, expectedRevision: snapshot.revision, data }
        : { action: "create", data });
      await onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save channel.");
    } finally { setBusy(false); }
  };

  return <FormDrawer open={open} onOpenChange={onOpenChange} size="md">
    <FormDrawer.Header>
      <FormDrawer.Title>{row ? "Edit channel" : "Add channel"}</FormDrawer.Title>
      <FormDrawer.Description>
        Channel configuration stores only connection references. Bot tokens remain in Integrations.
      </FormDrawer.Description>
    </FormDrawer.Header>
    <FormDrawer.Body className="space-y-4">
      <Field label="Name"><Input value={name} maxLength={120} placeholder="Support bot" onChange={(event) => setName(event.target.value)}/></Field>
      <Field label="Provider">
        <select className={selectClass} value={provider} onChange={(event) => changeProvider(event.target.value as ChannelProviderId)}>
          <option value="telegram">Telegram</option><option value="discord">Discord</option>
        </select>
      </Field>
      <Field label="Integration connection">
        {credentials.length ? <select className={selectClass} value={credential} onChange={(event) => setCredential(event.target.value)}>
          {credentials.map((item) => <option key={`${item.user}:${item.id}`} value={credentialValue(item.user, item.id)}>
            {item.userLabel} / {item.label} · {item.state}
          </option>)}
        </select> : <div className="rounded-lg border border-dashed p-3">
          <p className="text-xs text-muted-foreground">No {provider} bot connection exists yet.</p>
          <Button className="mt-2" size="sm" variant="outline" onClick={() => openWindow("integrations", "Integrations")}><Plug className="mr-2 size-3"/>Open Integrations</Button>
        </div>}
      </Field>
      <Field label={provider === "telegram" ? "Default chat ID / @channel" : "Default channel ID"}>
        <Input value={target} placeholder={provider === "telegram" ? "-1001234567890" : "123456789012345678"} onChange={(event) => setTarget(event.target.value)}/>
      </Field>
      <Field label="Inbound workflow">
        <select className={selectClass} value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
          <option value="">Receive only — no workflow</option>
          {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
        </select>
      </Field>
      <label className="flex items-center justify-between rounded-lg border p-3">
        <span><span className="block text-sm font-medium">Enabled</span><span className="text-xs text-muted-foreground">Allow send and verified inbound events.</span></span>
        <Switch checked={enabled} onCheckedChange={setEnabled}/>
      </label>
      <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        {provider === "telegram"
          ? "Inbound Telegram requires a webhook secret on the selected Integration connection."
          : "Inbound Discord uses the application public key to verify signed Interactions. Gateway message ingestion is intentionally not enabled."}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </FormDrawer.Body>
    <FormDrawer.Footer>
      <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={busy || !name.trim() || !credential} onClick={() => void save()}>{busy ? "Saving…" : "Save channel"}</Button>
    </FormDrawer.Footer>
  </FormDrawer>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium">{label}</span>{children}</label>;
}
