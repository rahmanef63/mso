"use client";

import { notifyAlfaSources, registerAlfaSources, type MentionItem } from "@/features/appshell";
import { HOST_TOOLS } from "../host-tools/catalog";
import { activeAgent, agentList, setActiveAgentId } from "./store";

// What @ and / offer, published to the shared composer. appshell owns the menu UI
// but cannot see agents (localStorage) or skills (/api/skills), so the assistant
// slice registers plain getters — see registerAlfaSources.
//
// WHY INSERTING TEXT IS THE WHOLE MECHANISM: the model only ever sees the string
// that gets sent. A completion that merely set local state would do nothing. So a
// pick writes a token the model acts on, and every capability behind it already
// exists — `skills.read` is a tool, so naming a skill is enough for Alfa to go and
// read it. No new endpoint, no attachment plumbing, no second execution path.
//
// Skills are fetched ONCE and cached for the tab, and NOT until the first `/`.
// There are ~88 of them, the read is ~600 KB of SKILL.md off disk server-side, and
// nothing renders them until that menu opens — it used to run on every signed-in
// page load. There are ~88 and the menu filters on every keystroke; refetching per
// keystroke would be absurd.

type SkillRow = { name: string; description?: string; trust?: string; source?: string };

let skillCache: MentionItem[] | null = null;
let inflight: Promise<void> | null = null;

function loadSkills(): void {
  if (skillCache || inflight) return;
  inflight = fetch("/api/skills", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { skills: [] }))
    .then((d: { skills?: SkillRow[] }) => {
      skillCache = (d.skills ?? [])
        .filter((s) => s.trust !== "untrusted")
        .map((s) => ({
          id: `skill:${s.name}`,
          label: s.name,
          hint: `${s.trust ?? "legacy"} · ${s.description ?? ""}`.slice(0, 70),
          // A directive, not a magic token: Alfa reads it and uses skills.read.
          insert: `Use the "${s.name}" skill.`,
          kind: "command" as const,
        }));
    })
    .catch(() => {
      skillCache = [];
    })
    .finally(() => {
      inflight = null;
      notifyAlfaSources(); // the composer computes its list during render
    });
}

// Executable tools sit alongside skills under `/` — they are the other thing a
// user means by "run something". Named exactly as the model calls them, so what
// the user picks and what appears in the approval card match.
const toolItems: MentionItem[] = HOST_TOOLS.map((t) => ({
  id: `tool:${t.name}`,
  label: t.name,
  hint: `${t.effect === "mutate" ? "needs approval · " : ""}${t.description.slice(0, 60)}`,
  insert: `Use the ${t.name} tool.`,
  kind: "command" as const,
}));

/**
 * Publish @ and / to the shared composer. Registered as a LOADER from
 * os-shell/integrations rather than called at module scope, so this module (tool
 * catalog + its run() closures + agent presets, ~88 KB) stays out of first load;
 * the first composer render pulls it in. Not called from the Assistant app either:
 * requiring that app to be open would leave the menus empty in exactly the surface
 * that needs them most — the per-app Alfa sheet.
 */
export function installAlfaSources(): void {
  registerAlfaSources({
    agents: () =>
      agentList().map((a) => ({
        id: `agent:${a.id}`,
        label: a.name,
        hint: a.persona?.slice(0, 70),
        insert: `@${a.name}`,
        kind: "agent" as const,
        // Picking an agent SWITCHES it. The persona is rebuilt into `system` on
        // every turn (lib/agent-request.ts), so this takes effect on the next
        // send — which is what the composer completion always claimed to do.
        onPick: () => setActiveAgentId(a.id),
      })),
    // Tools FIRST. There are ~19 of them against ~88 skills, and the menu caps at
    // 8 rows — skills-first meant a bare "/" only ever showed skills and the
    // executable tools were unreachable without typing their name. Filtering still
    // reaches everything; this only decides what an empty query shows.
    commands: () => {
      loadSkills(); // first `/` starts the fetch; tools render immediately
      return [...toolItems, ...(skillCache ?? [])];
    },
    activeAgentName: () => activeAgent()?.name ?? null,
  });
}
