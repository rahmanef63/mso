"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FormDrawer } from "@/features/appshell";
import { agentGroupAction, loadTelegramCredentials, type TelegramCredentialOption } from "../lib/api";
import type { AgentGroupMember, AgentGroupView } from "../types";

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const credValue = (user: string, connection: string) => `${user}::${connection}`;

type DraftMember = { name: string; profile: string; credential: string; target: string };
const emptyMember = (): DraftMember => ({ name: "", profile: "", credential: "", target: "" });

export function AgentGroupEditor({
  open,
  onOpenChange,
  row,
  revision,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  row: AgentGroupView | null;
  revision: number;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [maxRounds, setMaxRounds] = useState(row?.maxRounds ?? 1);
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const [members, setMembers] = useState<DraftMember[]>(
    row?.members.length
      ? row.members.map((member) => ({
          name: member.name,
          profile: member.profile,
          credential: member.telegram ? credValue(member.telegram.user, member.telegram.connection) : "",
          target: member.telegram?.target ?? "",
        }))
      : [emptyMember()],
  );
  const [credentials, setCredentials] = useState<TelegramCredentialOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    loadTelegramCredentials().then(setCredentials).catch(() => setCredentials([]));
  }, [open]);

  const patch = (index: number, next: Partial<DraftMember>) =>
    setMembers((rows) => rows.map((rowItem, position) => (position === index ? { ...rowItem, ...next } : rowItem)));

  const save = async () => {
    const parsed: AgentGroupMember[] = [];
    for (const member of members) {
      if (!member.name.trim() || !member.profile.trim()) { setError("Every agent needs a name and a Hermes profile."); return; }
      const payload: AgentGroupMember = { id: "", name: member.name.trim(), profile: member.profile.trim() };
      if (member.credential) {
        const [user, connection] = member.credential.split("::");
        if (!user || !connection || !member.target.trim()) { setError("A Telegram link needs a connection and a target."); return; }
        payload.telegram = { user, connection, target: member.target.trim() };
      }
      parsed.push(payload);
    }
    setBusy(true); setError("");
    try {
      const data = { name, maxRounds, enabled, members: parsed.map((member, index) => ({ ...member, id: member.id || `m${index + 1}` })) };
      await agentGroupAction(row ? { action: "update", id: row.id, expectedRevision: revision, data } : { action: "create", data });
      await onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the group.");
    } finally { setBusy(false); }
  };

  return <FormDrawer open={open} onOpenChange={onOpenChange} size="lg">
    <FormDrawer.Header>
      <FormDrawer.Title>{row ? "Edit agent group" : "New agent group"}</FormDrawer.Title>
      <FormDrawer.Description>
        Each agent runs as its own Hermes profile. Replies are mirrored to the group Telegram channel when a connection is set.
      </FormDrawer.Description>
    </FormDrawer.Header>
    <FormDrawer.Body className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5"><span className="text-xs font-medium">Group name</span>
          <Input value={name} maxLength={120} placeholder="Council" onChange={(event) => setName(event.target.value)}/></label>
        <label className="block space-y-1.5"><span className="text-xs font-medium">Rounds</span>
          <select className={selectClass} value={maxRounds} onChange={(event) => setMaxRounds(Number(event.target.value))}>
            <option value={1}>1: opening statements</option>
            <option value={2}>2: open + respond</option>
            <option value={3}>3: open + respond + close</option>
          </select></label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Agents</span>
          <Button size="sm" variant="outline" onClick={() => setMembers((rows) => [...rows, emptyMember()])}><Plus className="mr-2 size-3"/>Add agent</Button>
        </div>
        {members.map((member, index) => <div key={index} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Users className="size-3.5 text-muted-foreground"/>
            <Input value={member.name} maxLength={60} placeholder="Display name" onChange={(event) => patch(index, { name: event.target.value })}/>
            <Input value={member.profile} maxLength={64} placeholder="Hermes profile (e.g. dita)" onChange={(event) => patch(index, { profile: event.target.value })}/>
            {members.length > 1 ? <Button size="icon" variant="ghost" aria-label="Remove agent" onClick={() => setMembers((rows) => rows.filter((_, position) => position !== index))}><Trash2 className="size-3"/></Button> : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={selectClass} value={member.credential} onChange={(event) => patch(index, { credential: event.target.value })}>
              <option value="">No Telegram link</option>
              {credentials.map((item) => <option key={`${item.user}:${item.id}`} value={credValue(item.user, item.id)}>
                {item.userLabel} / {item.label} · {item.state}
              </option>)}
            </select>
            <Input value={member.target} placeholder="Telegram chat ID (-100…)" disabled={!member.credential} onChange={(event) => patch(index, { target: event.target.value })}/>
          </div>
        </div>)}
      </div>

      <label className="flex items-center justify-between rounded-lg border p-3">
        <span><span className="block text-sm font-medium">Enabled</span><span className="text-xs text-muted-foreground">Allow starting discussions from this app.</span></span>
        <Switch checked={enabled} onCheckedChange={setEnabled}/>
      </label>

      <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        Telegram bot tokens stay in Integrations. Pick one or more Telegram connections. Each agent posts as its own bot.
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </FormDrawer.Body>
    <FormDrawer.Footer>
      <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save group"}</Button>
    </FormDrawer.Footer>
  </FormDrawer>;
}
