import type { OrganizationChart, OrganizationSeat, OrganizationUnit } from "@/lib/contracts/organization";

type Positioned<T> = { item: T; position: { x: number; y: number } };
export type OrganizationLayoutOptions = { maxColumns?: number; xGap?: number; yGap?: number; startX?: number; startY?: number };
const DEFAULT_X_GAP = 270;
const DEFAULT_Y_GAP = 176;

function layered<T extends { id: string }>(
  items: T[],
  parentId: (item: T) => string | undefined,
  options: OrganizationLayoutOptions = {},
): Positioned<T>[] {
  const xGap = options.xGap ?? DEFAULT_X_GAP;
  const yGap = options.yGap ?? DEFAULT_Y_GAP;
  const startX = options.startX ?? 80;
  const startY = options.startY ?? 70;
  const maxColumns = Math.max(1, Math.trunc(options.maxColumns ?? Number.MAX_SAFE_INTEGER));
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

  const levels = new Map<number, T[]>();
  for (const item of items) levels.set(depth.get(item.id)!, [...(levels.get(depth.get(item.id)!) ?? []), item]);
  for (const row of levels.values()) row.sort((a, b) => a.id.localeCompare(b.id));

  const rowCount = new Map<number, number>();
  for (const [level, row] of levels) rowCount.set(level, Math.max(1, Math.ceil(row.length / maxColumns)));
  const orderedLevels = [...levels.keys()].sort((a, b) => a - b);
  const yBase = new Map<number, number>();
  let yRows = 0;
  for (const level of orderedLevels) {
    yBase.set(level, yRows);
    yRows += rowCount.get(level) ?? 1;
  }
  const widestColumns = Math.max(1, ...[...levels.values()].map((row) => Math.min(maxColumns, row.length)));
  const globalSpan = (widestColumns - 1) * xGap;

  return items.map((item) => {
    const level = depth.get(item.id)!;
    const row = levels.get(level)!;
    const index = row.findIndex((entry) => entry.id === item.id);
    const chunkIndex = Math.floor(index / maxColumns);
    const chunkStart = chunkIndex * maxColumns;
    const chunkLength = Math.min(maxColumns, row.length - chunkStart);
    const chunkIndexWithin = index - chunkStart;
    const span = (chunkLength - 1) * xGap;
    return {
      item,
      position: {
        x: startX + (globalSpan - span) / 2 + chunkIndexWithin * xGap,
        y: startY + ((yBase.get(level) ?? 0) + chunkIndex) * yGap,
      },
    };
  });
}

export function organizationUnitLayout(chart: OrganizationChart, options?: OrganizationLayoutOptions): Positioned<OrganizationUnit>[] {
  return layered(chart.units.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), (unit) => unit.parentUnitId, options);
}

export function organizationSeatLayout(chart: OrganizationChart, unitId: string, options?: OrganizationLayoutOptions): Array<Positioned<OrganizationSeat> & { external: boolean }> {
  const local = chart.seats.filter((seat) => seat.unitId === unitId);
  const localIds = new Set(local.map((seat) => seat.id));
  const outsideParentIds = new Set(local.map((seat) => seat.reportsToSeatId).filter((id): id is string => Boolean(id && !localIds.has(id))));
  const external = chart.seats.filter((seat) => outsideParentIds.has(seat.id));
  const items = [...external, ...local].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  return layered(items, (seat) => seat.reportsToSeatId, options).map((entry) => ({ ...entry, external: !localIds.has(entry.item.id) }));
}
