"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Agent, Automation, Skill } from "./types";
import { PRESET_AGENTS, PRESET_AUTOMATIONS, PRESET_SKILLS } from "./presets";
import { KEYS, load, loadActive, persist } from "./store-persist";

const uid = () => crypto.randomUUID().slice(0, 8);

// Client-only persistence. No Convex — agents/skills/automations live entirely
// in localStorage, like the mock's Create-App flows.
// ─── module store, not a per-mount hook ────────────────────────────────────────
// This used to be four useState calls with write-back effects, which meant the
// agent existed only while the Assistant app was mounted. The Alfa sheet and the
// desktop dock therefore could not read it, let alone switch it — which is why
// the @agent completion was cosmetic. Same shape as appshell/lib/alfa.ts, and the
// same localStorage keys, so existing user data loads unchanged.
//
// The hook's RETURN shape is deliberately identical to the old one: every consumer
// keeps working untouched, only the backing changed.

let skills: Skill[] = load(KEYS.skills, PRESET_SKILLS);
let agents: Agent[] = load(KEYS.agents, PRESET_AGENTS);
let automations: Automation[] = load(KEYS.autos, PRESET_AUTOMATIONS);
let activeAgentId: string = loadActive();

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (fn: () => void): (() => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

// Stable getters: useSyncExternalStore compares by reference.
const getSkills = () => skills;
const getAgents = () => agents;
const getAutos = () => automations;
const getActiveId = () => activeAgentId;

function setSkillsState(next: Skill[]): void {
  skills = next;
  persist(KEYS.skills, next);
  emit();
}
function setAgentsState(next: Agent[]): void {
  agents = next;
  persist(KEYS.agents, next);
  emit();
}
function setAutosState(next: Automation[]): void {
  automations = next;
  persist(KEYS.autos, next);
  emit();
}

/** The active agent, read fresh. NEVER cache this in a ref: sendToAlfa can invoke
 *  the engine synchronously in the same tick as a switch, so a ref would still hold
 *  the previous agent and the first turn after an @mention would use the old
 *  persona. Callers read it at use time. */
// Cross-tab. The hook this replaced re-ran load() in its useState initialiser on
// EVERY mount, so a tab that opened the Assistant after another tab had written
// picked up the newer data before writing anything of its own. A module store reads
// once at import, which silently removed that: every mutator writes the WHOLE array,
// so tab A mutating anything would overwrite an agent tab B had created — permanent,
// no error, no cue.
//
// `storage` fires only in the OTHER tabs, which is exactly what is needed: the
// writer already has the value, the readers re-read the one key that changed.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.storageArea && e.storageArea !== localStorage) return;
    switch (e.key) {
      case KEYS.skills:
        skills = load(KEYS.skills, PRESET_SKILLS);
        break;
      case KEYS.agents:
        agents = load(KEYS.agents, PRESET_AGENTS);
        break;
      case KEYS.autos:
        automations = load(KEYS.autos, PRESET_AUTOMATIONS);
        break;
      case KEYS.active:
        activeAgentId = loadActive();
        break;
      // null = the whole store was cleared (devtools, "clear site data").
      case null:
        skills = load(KEYS.skills, PRESET_SKILLS);
        agents = load(KEYS.agents, PRESET_AGENTS);
        automations = load(KEYS.autos, PRESET_AUTOMATIONS);
        activeAgentId = loadActive();
        break;
      default:
        return; // not ours
    }
    emit();
  });
}

export function activeAgent(): Agent {
  return agents.find((a) => a.id === activeAgentId) ?? agents[0];
}

export function agentList(): Agent[] {
  return agents;
}

export function setActiveAgentId(id: string): void {
  if (activeAgentId === id || !agents.some((a) => a.id === id)) return;
  activeAgentId = id;
  persist(KEYS.active, id);
  emit();
}

export type AIStore = ReturnType<typeof useAIStore>;

export function useAIStore() {
  const skillsNow = useSyncExternalStore(subscribe, getSkills, getSkills);
  const agentsNow = useSyncExternalStore(subscribe, getAgents, getAgents);
  const autosNow = useSyncExternalStore(subscribe, getAutos, getAutos);
  const activeId = useSyncExternalStore(subscribe, getActiveId, getActiveId);

  const addSkill = useCallback((s: Omit<Skill, "id">) => {
    const sk: Skill = { id: `sk_${uid()}`, builtin: false, ...s };
    setSkillsState([...skills, sk]);
    return sk;
  }, []);
  const updateSkill = useCallback((id: string, patch: Partial<Skill>) => {
    setSkillsState(skills.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);
  const removeSkill = useCallback((id: string) => {
    setSkillsState(skills.filter((s) => s.id !== id));
    setAgentsState(agents.map((a) => ({ ...a, skills: a.skills.filter((x) => x !== id) })));
  }, []);

  const addAgent = useCallback((a: Omit<Agent, "id">) => {
    const ag: Agent = { id: `ag_${uid()}`, builtin: false, ...a };
    setAgentsState([...agents, ag]);
    return ag;
  }, []);
  const updateAgent = useCallback((id: string, patch: Partial<Agent>) => {
    setAgentsState(agents.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);
  const removeAgent = useCallback((id: string) => {
    const next = agents.filter((a) => a.id !== id);
    setAgentsState(next);
    // Never leave the pointer dangling at a deleted agent.
    if (activeAgentId === id && next[0]) {
      activeAgentId = next[0].id;
      persist(KEYS.active, activeAgentId);
      emit();
    }
  }, []);

  const addAutomation = useCallback((a: Omit<Automation, "id">) => {
    const au: Automation = { id: `au_${uid()}`, builtin: false, ...a };
    setAutosState([...automations, au]);
    return au;
  }, []);
  const updateAutomation = useCallback((id: string, patch: Partial<Automation>) => {
    setAutosState(automations.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);
  const removeAutomation = useCallback((id: string) => {
    setAutosState(automations.filter((a) => a.id !== id));
  }, []);

  return {
    skills: skillsNow,
    agents: agentsNow,
    automations: autosNow,
    activeAgent: agentsNow.find((a) => a.id === activeId) ?? agentsNow[0],
    activeAgentId: activeId,
    setActiveAgentId,
    addSkill,
    updateSkill,
    removeSkill,
    addAgent,
    updateAgent,
    removeAgent,
    addAutomation,
    updateAutomation,
    removeAutomation,
  };
}
