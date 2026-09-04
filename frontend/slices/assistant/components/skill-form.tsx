"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SKILL_COLORS, SKILL_ICONS } from "../lib/presets";
import type { AIStore } from "../lib/store";
import type { Skill } from "../lib/types";
import { Field, FormShell } from "./form-shell";
import { GlyphTile } from "./agent-avatar";
import { ColorPick, GlyphPick } from "./pickers";
import { ToolPicker } from "./tool-picker";

export function SkillForm({
  skill,
  store,
  onClose,
}: {
  skill?: Skill;
  store: AIStore;
  onClose: () => void;
}) {
  const editing = !!skill;
  const [name, setName] = useState(skill?.name ?? "New Playbook");
  const [glyph, setGlyph] = useState(skill?.glyph ?? "sparkles");
  const [color, setColor] = useState(skill?.color ?? SKILL_COLORS[0]);
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [tools, setTools] = useState<string[]>(skill?.tools ?? []);
  const [starters, setStarters] = useState((skill?.starters ?? []).join("\n"));

  const save = () => {
    const payload = {
      name,
      glyph,
      color,
      instructions,
      tools,
      starters: starters
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (editing && skill) store.updateSkill(skill.id, payload);
    else store.addSkill(payload);
    onClose();
  };

  return (
    <FormShell
      title={editing ? "Edit Playbook" : "Create Playbook"}
      editing={editing}
      onClose={onClose}
      onSave={save}
      preview={
        <div className="flex flex-col items-center gap-2">
          <GlyphTile glyph={glyph} color={color} size={60} />
          <span className="font-semibold">{name}</span>
          <span className="text-[11px] text-muted-foreground">{tools.length} tools</span>
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
      <Field label="Instructions" hint="Your own note on how to use this playbook. NOT sent to the model — only the agent's persona reaches the system prompt.">
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Organize the filesystem; keep names tidy…"
          className="min-h-16"
        />
      </Field>
      <Field label="Tools" hint="Your own note of what this playbook leans on. Not a grant — Alfa gets every tool on every turn.">
        <ToolPicker value={tools} onChange={setTools} />
      </Field>
      <Field label="Starter prompts" hint="One per line — shown as quick chips.">
        <Textarea
          value={starters}
          onChange={(e) => setStarters(e.target.value)}
          className="min-h-14 text-xs"
        />
      </Field>
    </FormShell>
  );
}
