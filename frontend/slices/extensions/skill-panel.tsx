"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SkillMarketSnapshot, SkillMarketRow } from "@/lib/contracts/skill-market";
import { ExtensionAccess } from "./access";
type ExistingSkill = { id: string; name: string; source: string; trust: string; description: string };
export function SkillStorePanel() { return <ExtensionAccess><OwnerSkillPanel /></ExtensionAccess>; }
function OwnerSkillPanel() {
  const [market, setMarket] = useState<SkillMarketSnapshot | null>(null);
  const [existing, setExisting] = useState<ExistingSkill[]>([]), [partial, setPartial] = useState(false);
  const [query, setQuery] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = loading || saving;
  const controller = useRef<AbortController | null>(null), generation = useRef(0), writing = useRef(false);
  const source = useRef(Symbol("skill-market"));
  const reload = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const epoch = ++generation.current;
    const current = () => !request.signal.aborted && generation.current === epoch;
    setLoading(true); setError("");
    try {
      const [response, installed] = await Promise.all([
        fetch("/api/v1/skill-market", { cache: "no-store", signal: request.signal }),
        fetch("/api/skills", { cache: "no-store", signal: request.signal }),
      ]);
      const [data, skills] = await Promise.all([response.json(), installed.json()]);
      if (!response.ok || !installed.ok) throw new Error(!response.ok ? data.error || "Skill market failed" : skills.error || "Skill discovery failed");
      if (!current()) return;
      setMarket(data); setExisting(skills.skills ?? []); setPartial(Boolean(skills.scan?.truncated));
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Skill catalog failed"); }
    finally { if (current()) setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.source !== source.current) void reload(); };
    window.addEventListener("mso:extensions-changed", changed);
    return () => { clearTimeout(timer); controller.current?.abort(); window.removeEventListener("mso:extensions-changed", changed); };
  }, [reload]);
  async function change(action: "install" | "remove", row: SkillMarketRow) {
    if (writing.current || busy) return;
    if (!window.confirm(`${action === "remove" ? "Remove" : "Install"} ${row.title} ${action === "remove" ? "from" : "on"} this VPS? Only this managed skill directory will change.`)) return;
    writing.current = true; setSaving(true); setError("");
    controller.current?.abort(); generation.current++;
    try {
      const response = await fetch("/api/v1/skill-market", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: row.id, revision: row.revision }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Skill operation failed");
      await reload();
      window.dispatchEvent(new CustomEvent("mso:extensions-changed", { detail: { source: source.current } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Skill operation failed"); }
    finally { writing.current = false; setSaving(false); }
  }
  const q = query.trim().toLowerCase();
  return <div className="min-w-0 space-y-4">
    <div className="space-y-2"><h2 className="text-sm font-semibold">Skills on this VPS</h2><p className="text-sm text-muted-foreground">Install copies a reviewed, checksum-verified skill into MSO’s local skill directory. Uninstall removes only unchanged, managed files. A skill never grants tool permissions.</p><div className="flex gap-2"><Input aria-label="Search skills" placeholder="Search skills" value={query} onChange={event => setQuery(event.target.value)} /><Button variant="secondary" disabled={busy} onClick={() => void reload()}>Refresh</Button></div></div>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}{busy && <p role="status" className="text-sm">Loading skill state…</p>}
    {market && <><p className="break-all text-xs text-muted-foreground">Install directory: {market.root}</p><div className="grid gap-3 @lg:grid-cols-2">{market.skills.filter(row => `${row.title} ${row.description}`.toLowerCase().includes(q)).map(row => <article key={row.id} className="space-y-3 rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{row.title}</h3><span className="text-xs text-muted-foreground">{row.state} · {row.version}</span></div><p className="text-sm text-muted-foreground">{row.description}</p><p className="text-xs text-muted-foreground">{row.source} · {row.security}</p><div className="flex flex-wrap gap-2">{row.canInstall && <Button size="sm" disabled={busy} onClick={() => void change("install", row)}>{row.state === "update-available" ? "Update" : "Install"}</Button>}{row.canRemove && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void change("remove", row)}>Uninstall</Button>}{!row.canInstall && !row.canRemove && <span className="text-xs text-muted-foreground">Local changes or unmanaged files require manual review.</span>}</div></article>)}</div></>}
    <section className="space-y-2"><h3 className="text-sm font-semibold">Discovered existing skills ({existing.length})</h3><p className="text-xs text-muted-foreground">Official, project and manually installed skills remain managed by their source; Store will not delete them.</p>{partial && <p className="text-xs text-muted-foreground">Discovery is bounded; this is a partial list.</p>}{existing.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(q)).map(skill => <div key={skill.id} className="rounded-lg border p-3"><p className="break-all text-sm font-medium">{skill.name}</p><p className="text-xs text-muted-foreground">{skill.source} · {skill.trust}</p></div>)}</section>
  </div>;
}
