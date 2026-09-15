"use client";
import { useEffect, useState } from "react";
import type { OrganizationChart } from "@/lib/contracts/organization";
const selectClass = "h-9 w-full rounded-md border bg-background px-2";
export function WorkflowAgentSeatField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [chart, setChart] = useState<OrganizationChart | null>(null);
  useEffect(() => { let alive = true; void fetch("/api/v1/organization?runtime=0", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()).then((body) => { if (alive) setChart(body.chart as OrganizationChart); }).catch(() => undefined); return () => { alive = false; }; }, []);
  return <label className="block space-y-1"><span className="text-muted-foreground">Organization seat</span><select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Direct project agent</option>{chart?.seats.slice().sort((a,b)=>a.title.localeCompare(b.title)).map((seat)=><option key={seat.id} value={seat.id}>{seat.title} · {seat.name}</option>)}</select><span className="block text-[10px] text-muted-foreground">When selected, execution target follows the Org Chart seat binding.</span></label>;
}
