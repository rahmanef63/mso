"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_COLORS, SKILL_ICONS } from "../lib/presets";
import type { AIStore } from "../lib/store";
import { OS_TOOLS } from "../lib/tools";
import type { Agent } from "../lib/types";
import { Field, FormShell } from "./form-shell";
import { GlyphTile } from "./agent-avatar";
import { ColorPick, GlyphPick } from "./pickers";

export function AgentForm({
  agent,
  store,
  onClose,
}: {
  agent?: Agent;
  store: AIStore;
  onClose: () => void;
}) {
  const editing = !!agent;
  const [name, setName] = useState(agent?.name ?? "New Agent");
  const [glyph, setGlyph] = useState(agent?.glyph ?? "sparkles");
  const [color, setColor] = useState(agent?.color ?? AGENT_COLORS[0]);
  const [persona, setPersona] = useState(agent?.persona ?? "");
  // Persisted, no longer editable here — see the note where the picker used to be.
  const allTools = agent?.allTools ?? false;
  const skills = agent?.skills ?? [];

  const save = () => {
    const payload = { name, glyph, color, persona, allTools, skills };
    if (editing && agent) store.updateAgent(agent.id, payload);
    else store.setActiveAgentId(store.addAgent(payload).id);
    onClose();
  };

  return (
    <FormShell
      title={editing ? "Edit Agent" : "Create Agent"}
      editing={editing}
      onClose={onClose}
      onSave={save}
      preview={
        <div className="flex flex-col items-center gap-2">
          <GlyphTile glyph={glyph} color={color} size={64} />
          <span className="font-semibold">{name}</span>
          <span className="text-[11px] text-muted-foreground">{OS_TOOLS.length} tools</span>
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
        <ColorPick value={color} onChange={setColor} options={AGENT_COLORS} />
      </Field>
      <Field label="Persona" hint="Voice & behaviour — sent as system context on every turn, so edits and agent switches apply to the next reply.">
        <Textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="e.g. Friendly editor that prefers vertical video…"
          className="min-h-16"
        />
      </Field>
      {/* A "Tool access" switch and a per-agent Skills picker used to sit here,
          offering "Generalist — all tools" vs "Curated — by skill". They configured
          NOTHING: use-host-commands.ts hands the model HOST_AI_TOOLS on every turn,
          with no agent in scope. CONTRACT.md is explicit that they must go — "every
          user-visible string that claims an agent is limited to some tools … until
          those are removed the UI states something untrue" — and a user who curated
          a System-only agent was still shipping fs.read over their whole read jail
          to their model provider while the UI said otherwise.
          `allTools` and `skills` stay on the Agent type: they are persisted, and
          store-migration.test.ts covers them. */}
    </FormShell>
  );
}
