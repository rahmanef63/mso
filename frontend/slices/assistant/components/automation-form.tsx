"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SKILL_COLORS, SKILL_ICONS } from "../lib/presets";
import type { AIStore } from "../lib/store";
import { GROUP_META, GROUP_ORDER, OS_TOOLS, toolById } from "../lib/tools";
import type { Automation, AutomationStep } from "../lib/types";
import { Field, FormShell } from "./form-shell";
import { GlyphTile } from "./agent-avatar";
import { ColorPick, GlyphPick } from "./pickers";

export function AutomationForm({
  auto,
  store,
  onClose,
}: {
  auto?: Automation;
  store: AIStore;
  onClose: () => void;
}) {
  const editing = !!auto;
  const [name, setName] = useState(auto?.name ?? "New Automation");
  const [glyph, setGlyph] = useState(auto?.glyph ?? "sparkles");
  const [color, setColor] = useState(auto?.color ?? SKILL_COLORS[0]);
  const [agentId, setAgentId] = useState(auto?.agentId ?? store.activeAgentId);
  const [steps, setSteps] = useState<AutomationStep[]>(() =>
    (auto?.steps ?? []).map((s) => ({ ...s, id: s.id ?? crypto.randomUUID() })),
  );

  const addStep = (tid: string) =>
    setSteps((s) => [...s, { tool: tid, argText: "", id: crypto.randomUUID() }]);
  const setArg = (i: number, v: string) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, argText: v } : x)));
  const move = (i: number, d: number) =>
    setSteps((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const a = [...s];
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
  const del = (i: number) => setSteps((s) => s.filter((_, j) => j !== i));

  const save = () => {
    const payload = { name, glyph, color, agentId, steps };
    if (editing && auto) store.updateAutomation(auto.id, payload);
    else store.addAutomation(payload);
    onClose();
  };
  const agent = store.agents.find((a) => a.id === agentId);

  return (
    <FormShell
      title={editing ? "Edit Automation" : "Create Automation"}
      editing={editing}
      onClose={onClose}
      onSave={save}
      preview={
        <div className="flex flex-col items-center gap-2">
          <GlyphTile glyph={glyph} color={color} size={60} />
          <span className="font-semibold">{name}</span>
          <span className="text-[11px] text-muted-foreground">
            {steps.length} steps · {agent?.name ?? "—"}
          </span>
        </div>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Icon">
        <GlyphPick value={glyph} onChange={setGlyph} options={SKILL_ICONS} />
      </Field>
      <Field label="Color">
        <ColorPick value={color} onChange={setColor} options={SKILL_COLORS} />
      </Field>
      <Field label="Run as agent" hint="Sets the persona for this run. Alfa still uses the same global host-tool catalog and approval policy.">
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-muted px-2.5 text-sm"
        >
          {store.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Steps"
        hint="Each step names the intended host tool in order. Args/context stay plain text; Alfa validates and maps them to the tool schema at run time."
      >
        <div className="flex flex-col gap-2">
          {steps.length === 0 ? (
            <div className="px-0.5 py-1.5 text-xs text-muted-foreground">
              No steps yet — add one below.
            </div>
          ) : null}
          {steps.map((s, i) => {
            const t = toolById(s.tool);
            return (
              <div
                key={s.id}
                className="flex items-start gap-2 rounded-lg border border-border bg-muted p-2.5"
              >
                <span className="mt-1.5 w-4 text-right text-[11px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">{t?.name ?? s.tool}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{s.tool}</span>
                  </div>
                  <Input
                    value={s.argText}
                    onChange={(e) => setArg(i, e.target.value)}
                    placeholder={t?.params.length ? `e.g. ${t.params[0]} value` : "no arguments"}
                    className="mt-1.5 h-7 font-mono text-[11px]"
                  />
                </div>
                <div className="flex flex-none flex-col gap-1">
                  <Button variant="ghost" size="icon" aria-label="Move step up" className="size-5" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Move step down" className="size-5" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-3" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Delete step" className="size-5 text-destructive" onClick={() => del(i)}>
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="self-start">
                <Plus className="size-3.5" /> Add step
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
              {GROUP_ORDER.map((g, gi) => {
                const tools = OS_TOOLS.filter((t) => t.group === g);
                if (!tools.length) return null;
                return (
                  <div key={g}>
                    {gi > 0 ? <DropdownMenuSeparator /> : null}
                    <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {GROUP_META[g].label}
                    </div>
                    {tools.map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => addStep(t.id)}>
                        {t.name}
                      </DropdownMenuItem>
                    ))}
                  </div>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Field>
    </FormShell>
  );
}
