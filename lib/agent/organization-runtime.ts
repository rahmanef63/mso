import type { OrganizationSeat, OrganizationSeatRuntime } from "@/lib/contracts/organization";
import { listA2AAgents } from "@/lib/a2a";
import { listLocalAgents } from "./local-agent-directory";
import { getOrganizationChart } from "./organization-store";

export function organizationLocalAgentPrincipal(principal: string): string { return principal.startsWith("web:") ? `cli:${principal.slice(4)}` : principal; }

export async function resolveOrganizationSeat(ref: string): Promise<OrganizationSeat> {
  const chart = await getOrganizationChart(), q = String(ref || "").trim().toLowerCase(); if (!q) throw new Error("organization seat reference is required");
  const rows = chart.seats.filter((seat) => [seat.id, seat.name, seat.title, seat.role].some((v) => v.toLowerCase() === q));
  if (!rows.length) throw new Error(`organization seat not found: ${ref}`); if (rows.length > 1) throw new Error(`organization seat is ambiguous: ${rows.map((r) => r.id).join(", ")}`); return rows[0];
}
export async function organizationRuntime(principal?: string): Promise<OrganizationSeatRuntime[]> {
  const chart = await getOrganizationChart(); const localPrincipal = principal ? organizationLocalAgentPrincipal(principal) : undefined; const [locals, a2a] = await Promise.all([localPrincipal ? listLocalAgents(localPrincipal, { includeOffline: true }).catch(() => []) : Promise.resolve([]), listA2AAgents().catch(() => [])]);
  return chart.seats.map((seat) => { const target = seat.target; if (seat.state === "vacant") return { seatId: seat.id, targetKind: target.kind, status: "vacant" };
    if (target.kind === "none") return { seatId: seat.id, targetKind: target.kind, status: "unbound", detail: "no execution target" };
    if (seat.state === "inactive" || seat.seatMode === "inactive") return { seatId: seat.id, targetKind: target.kind, status: "offline", detail: "inactive seat" };
    if (target.kind === "project-agent") return { seatId: seat.id, targetKind: target.kind, status: "ready", label: target.project };
    if (target.kind === "local-agent") { const q = target.ref.toLowerCase(), row = locals.find((x) => [x.id, x.alias, x.name, x.label].some((v) => v.toLowerCase() === q)); return row ? { seatId: seat.id, targetKind: target.kind, status: row.status === "busy" ? "busy" : ["offline", "ended"].includes(row.status) ? "offline" : "ready", label: row.label, detail: row.status } : { seatId: seat.id, targetKind: target.kind, status: "unresolved", label: target.ref }; }
    const q = target.ref.toLowerCase(), row = a2a.find((x) => [x.id, x.alias, x.card.name].some((v) => v.toLowerCase() === q)); return row ? { seatId: seat.id, targetKind: target.kind, status: "ready", label: row.alias } : { seatId: seat.id, targetKind: target.kind, status: "unresolved", label: target.ref };
  });
}
