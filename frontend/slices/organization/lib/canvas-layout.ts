import type { OrganizationChart, OrganizationSeat, OrganizationUnit } from "@/lib/contracts/organization";

type Positioned<T> = { item: T; position: { x: number; y: number } };
const X_GAP = 270;
const Y_GAP = 176;

function layered<T extends { id: string }>(items: T[], parentId: (item: T) => string | undefined): Positioned<T>[] {
  const ids = new Set(items.map((item) => item.id));
  const depth = new Map<string, number>();
  const resolve = (item: T, trail = new Set<string>()): number => {
    if (depth.has(item.id)) return depth.get(item.id)!;
    if (trail.has(item.id)) return 0;
    const parent = parentId(item);
    if (!parent || !ids.has(parent)) { depth.set(item.id, 0); return 0; }
    const nextTrail = new Set(trail).add(item.id);
    const parentItem = items.find((row) => row.id === parent);
    const value = parentItem ? resolve(parentItem, nextTrail) + 1 : 0;
    depth.set(item.id, value);
    return value;
  };
  for (const item of items) resolve(item);
  const rows = new Map<number, T[]>();
  for (const item of items) rows.set(depth.get(item.id)!, [...(rows.get(depth.get(item.id)!) ?? []), item]);
  for (const row of rows.values()) row.sort((a, b) => a.id.localeCompare(b.id));
  const widest = Math.max(1, ...[...rows.values()].map((row) => row.length));
  return items.map((item) => {
    const level = depth.get(item.id)!;
    const row = rows.get(level)!;
    const index = row.findIndex((entry) => entry.id === item.id);
    const span = (row.length - 1) * X_GAP;
    const globalSpan = (widest - 1) * X_GAP;
    return { item, position: { x: (globalSpan - span) / 2 + index * X_GAP + 80, y: 70 + level * Y_GAP } };
  });
}

export function organizationUnitLayout(chart: OrganizationChart): Positioned<OrganizationUnit>[] {
  return layered(chart.units.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), (unit) => unit.parentUnitId);
}

export function organizationSeatLayout(chart: OrganizationChart, unitId: string): Array<Positioned<OrganizationSeat> & { external: boolean }> {
  const local = chart.seats.filter((seat) => seat.unitId === unitId);
  const localIds = new Set(local.map((seat) => seat.id));
  const outsideParentIds = new Set(local.map((seat) => seat.reportsToSeatId).filter((id): id is string => Boolean(id && !localIds.has(id))));
  const external = chart.seats.filter((seat) => outsideParentIds.has(seat.id));
  const items = [...external, ...local].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  return layered(items, (seat) => seat.reportsToSeatId).map((entry) => ({ ...entry, external: !localIds.has(entry.item.id) }));
}
