"use client";

import { useEffect, useState, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
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
  latest,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  row: AgentGroupView | null;
  revision: number;
  latest?: AgentGroupView;
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
  const saving = useRef(false);
  const addAgentRef = useRef<HTMLButtonElement>(null);
  const [baseRevision, setBaseRevision] = useState(revision);
  const initialDraft = useRef(JSON.stringify([name, maxRounds, enabled, members]));
  const close = (next: boolean) => {
    if (!next && (busy || (JSON.stringify([name, maxRounds, enabled, members]) !== initialDraft.current && !window.confirm("Discard unsaved changes?")))) return;
    onOpenChange(next);
  };

  useEffect(() => {
    if (!open) return;
    loadTelegramCredentials().then(setCredentials).catch(() => setCredentials([]));
  }, [open]);

  const patch = (index: number, next: Partial<DraftMember>) =>
    setMembers((rows) => rows.map((rowItem, position) => (position === index ? { ...rowItem, ...next } : rowItem)));

  const save = async () => {
    if (saving.current) return;
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
    saving.current = true; setBusy(true); setError("");
    try {
      const data = { name, maxRounds, enabled, members: parsed.map((member, index) => ({ ...member, id: member.id || `m${index + 1}` })) };
      await agentGroupAction(row ? { action: "update", id: row.id, expectedRevision: baseRevision, data } : { action: "create", data });
      await onSaved();
      onOpenChange(false);
    } catch (cause) {
      await onSaved().catch(() => undefined);
      setError((cause instanceof Error ? cause.message : "Could not save the group.") + " Your draft is preserved; close and reopen to load the latest version.");
    } finally { saving.current = false; setBusy(false); }
  };

  return <FormDrawer open={open} onOpenChange={close} size="lg">
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
          <Button ref={addAgentRef} size="sm" variant="outline" onClick={() => setMembers((rows) => [...rows, emptyMember()])}><Plus className="mr-2 size-3"/>Add agent</Button>
        </div>
        {members.map((member, index) => <fieldset key={index} className="space-y-2 rounded-lg border p-3"><legend className="px-1 text-xs font-medium">Agent {index + 1}</legend>
          <div className="grid min-w-0 gap-2 @min-[480px]:grid-cols-2">
            <label className="min-w-0 text-xs">Display name<Input value={member.name} maxLength={60} placeholder="Display name" onChange={(event) => patch(index, { name: event.target.value })}/></label>
            <label className="min-w-0 text-xs">Hermes profile<Input value={member.profile} maxLength={64} placeholder="Hermes profile (e.g. dita)" onChange={(event) => patch(index, { profile: event.target.value })}/></label>
            {members.length > 1 ? <Button size="icon" variant="ghost" aria-label={`Remove agent ${member.name || index + 1}`} onClick={() => { setMembers((rows) => rows.filter((_, position) => position !== index)); addAgentRef.current?.focus(); }}><Trash2 className="size-3"/></Button> : null}
          </div>
          <div className="grid gap-2 @min-[480px]:grid-cols-2">
            <label className="min-w-0 text-xs">Telegram connection<select className={selectClass} value={member.credential} onChange={(event) => patch(index, { credential: event.target.value })}>
              <option value="">No Telegram link</option>
              {credentials.map((item) => <option key={`${item.user}:${item.id}`} value={credValue(item.user, item.id)}>
                {item.userLabel} / {item.label} · {item.state}
              </option>)}
            </select></label>
            <label className="min-w-0 text-xs">Telegram target<Input value={member.target} placeholder="Telegram chat ID (-100…)" disabled={!member.credential} onChange={(event) => patch(index, { target: event.target.value })}/></label>
          </div>
        </fieldset>)}
      </div>

      <label className="flex items-center justify-between rounded-lg border p-3">
        <span><span className="block text-sm font-medium">Enabled</span><span className="text-xs text-muted-foreground">Allow starting discussions from this app.</span></span>
        <Switch checked={enabled} onCheckedChange={setEnabled}/>
      </label>

      <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        Telegram bot tokens stay in Integrations. Pick one or more Telegram connections. Each agent posts as its own bot.
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {error && row && revision !== baseRevision ? <div className="space-y-2 rounded border p-2 text-xs">
        <p>The saved group changed. Compare it with your draft above before choosing to overwrite its fields.</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(latest ? { name: latest.name, members: latest.members, maxRounds: latest.maxRounds, enabled: latest.enabled } : "Group no longer exists", null, 2)}</pre>
        <Button variant="outline" size="sm" onClick={() => { setBaseRevision(revision); setError(""); }}>Use latest revision for this draft</Button>
      </div> : null}
    </FormDrawer.Body>
    <FormDrawer.Footer>
      <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
      <Button disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save group"}</Button>
    </FormDrawer.Footer>
  </FormDrawer>;
}
