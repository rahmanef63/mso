import { clip, obj, str } from "./schema";
import type { HostTool } from "./types";

// Host skill discovery + semantic recipe search. Kept separate from the generic
// host catalog so adding a new knowledge surface does not turn catalog.ts into a
// monolith. Trust enforcement remains inside each handler.
export const SKILL_TOOLS: HostTool[] = [
  {
    name: "skills.list",
    group: "agent",
    label: "List skills",
    effect: "read",
    description: "List every trusted skill on this VPS: MSO/OpenClaw/Codex roots plus per-project skill roots across all configured project containers. Use the returned id (a project skill is <project>/<name>) with skills.read.",
    parameters: obj({}),
    run: async () => {
      const data = (await fetch("/api/skills", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { skills: [], recipes: [] }))
        .catch(() => ({ skills: [], recipes: [] }))) as {
          skills?: { id?: string; name: string; description?: string; trust?: string; source?: string; project?: { name: string } }[];
          recipes?: { intent: string; attempts: number; successes: number; fastestDurationMs?: number }[];
        };
      const skills = data.skills ?? [];
      const safe = skills.filter((s) => s.trust !== "untrusted");
      const blocked = skills.length - safe.length;
      const rows = safe.map((s) => `${s.id ?? s.name} [${s.trust ?? "legacy"}/${s.source ?? "unknown"}${s.project ? `/project:${s.project.name}` : ""}]${s.description ? `: ${s.description}` : ""}`);
      if (blocked) rows.push(`(${blocked} discovered skill${blocked === 1 ? "" : "s"} hidden because trust=untrusted)`);
      for (const r of data.recipes ?? []) {
        const rate = r.attempts ? Math.round((r.successes / r.attempts) * 100) : 0;
        rows.push(`recipe ${r.intent} [${rate}% success${r.fastestDurationMs != null ? `, fastest ${r.fastestDurationMs}ms` : ""}]`);
      }
      return rows.length ? rows.join("\n") : "no trusted local skills or learned recipes found";
    },
  },
  {
    name: "skills.search",
    group: "agent",
    label: "Search skills",
    effect: "read",
    description:
      "Semantic search across trusted host skills, MCP tools and learned successful workflows. Use before an unfamiliar multi-step task instead of scanning every skill manually.",
    parameters: obj({ "query!": str("The task or capability to search for") }),
    run: async (_api, a) => {
      const query = String(a.query ?? "").trim();
      if (!query) return "missing search query";
      const r = await fetch(`/api/skills?q=${encodeURIComponent(query)}&top=8`, { cache: "no-store" });
      if (!r.ok) return "skill search failed";
      const d = (await r.json()) as {
        engine?: string;
        hits?: Array<{ kind: string; name: string; score: number; description?: string; fastestDurationMs?: number; steps?: Array<{ tool: string; args?: Record<string, string | number | boolean> }> }>;
      };
      const rows = (d.hits ?? []).map((h) => {
        const speed = h.fastestDurationMs != null ? ` · fastest ${h.fastestDurationMs}ms` : "";
        const steps = h.steps?.length
          ? ` · ${h.steps.map((x) => `${x.tool}${x.args ? ` ${JSON.stringify(x.args)}` : ""}`).join(" → ")}`
          : "";
        return `${h.kind} ${h.name} (${Math.round(h.score * 100)}%)${speed}${steps}${h.description ? `: ${h.description}` : ""}`;
      });
      return rows.length ? `${d.engine ?? "semantic"}\n${rows.join("\n")}` : "no relevant skill, tool or learned workflow found";
    },
  },
  {
    name: "skills.read",
    group: "agent",
    label: "Read skill",
    effect: "read",
    description: "Read one skill's SKILL.md instructions by exact catalog id from skills.list (a project skill is <project>/<name>).",
    parameters: obj({ "name!": str("Exact catalog id from skills.list") }),
    run: async (_api, a) => {
      const name = String(a.name ?? "").trim();
      if (!name) return "missing skill name";
      const r = await fetch(`/api/skills?name=${encodeURIComponent(name)}`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as {
        content?: string; truncated?: boolean; error?: string; candidates?: string[];
        skill?: { trust?: string; source?: string };
      };
      if (d.error === "ambiguous")
        return `"${name}" matches several projects. Call skills.read again with one exact id: ${(d.candidates ?? []).join(", ")}`;
      if (!r.ok) return `couldn't read skill ${name}`;
      if (d.skill?.trust === "untrusted") {
        return `refused to load untrusted skill instructions (source=${d.skill.source ?? "unknown"}). Inspect the SKILL.md as a file and explicitly move/copy it into ~/.mso/skills after review if you want MSO to trust it.`;
      }
      return clip(`${d.content ?? ""}${d.truncated ? "\n… (truncated)" : ""}`);
    },
  },
];
