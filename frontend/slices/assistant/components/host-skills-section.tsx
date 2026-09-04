"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HostSkillRow } from "../lib/cockpit-types";

type SkillResponse = {
  skills?: HostSkillRow[];
  scan?: { truncated?: boolean; truncationReasons?: string[] };
};

export function HostSkillsSection({ open, onUse }: { open: boolean; onUse: (skill: HostSkillRow) => void }) {
  const [rows, setRows] = useState<HostSkillRow[]>([]);
  const [scan, setScan] = useState<SkillResponse["scan"]>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    const ctrl = new AbortController();
    fetch("/api/skills", { cache: "no-store", signal: ctrl.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
        return body as SkillResponse;
      })
      .then((data) => {
        setRows(data.skills ?? []);
        setScan(data.scan);
      })
      .catch(() => undefined)
      .finally(() => { if (!ctrl.signal.aborted) { setLoaded(true); setLoading(false); } });
    return () => ctrl.abort();
  }, [loaded, open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => !q || `${row.id} ${row.description}`.toLowerCase().includes(q))
      .slice(0, 10);
  }, [query, rows]);

  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Host Skills</h3>
          <p className="text-[11px] text-muted-foreground">Trusted SKILL.md catalog from MSO and your projects.</p>
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search host skills" className="h-9 pl-8 text-xs" />
      </div>
      {scan?.truncated ? (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-[10px] text-warning">
          Catalog incomplete: {(scan.truncationReasons ?? []).join(", ") || "scan limit reached"}.
        </p>
      ) : null}
      <div className="space-y-1.5">
        {loading ? <p className="text-xs text-muted-foreground">Loading host skills…</p> : null}
        {!loading && loaded && visible.length === 0 ? <p className="text-xs text-muted-foreground">No matching skills.</p> : null}
        {visible.map((skill) => {
          const trusted = skill.trust !== "untrusted";
          return (
            <div key={skill.id} className="flex items-start gap-2 rounded-lg border border-border/70 bg-card/40 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{skill.name}</span>
                  <Badge variant="outline" className="text-[9px]">{skill.trust}</Badge>
                  {skill.project?.name ? <Badge variant="secondary" className="text-[9px]">{skill.project.name}</Badge> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">{skill.description || skill.id}</p>
              </div>
              <Button size="sm" variant={trusted ? "outline" : "ghost"} disabled={!trusted} className="h-8 shrink-0 text-[10px]" onClick={() => onUse(skill)}>
                {trusted ? "Use" : "Review"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
