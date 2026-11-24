import type { OrganizationChart, OrganizationSeat, OrganizationUnit } from "./org-api.ts";

export type Positioned<T> = { item: T; x: number; y: number; depth: number };
export type OrgLayoutOptions = { maxColumns?: number; xGap?: number; yGap?: number; startX?: number; startY?: number };

const X_GAP = 244;
const Y_GAP = 164;

function layer<T extends { id: string }>(
  items: T[], parentId: (item: T) => string | undefined, options: OrgLayoutOptions = {},
): Positioned<T>[] {
  const xGap = options.xGap ?? X_GAP, yGap = options.yGap ?? Y_GAP;
  const startX = options.startX ?? 40, startY = options.startY ?? 30;
  const maxColumns = Math.max(1, Math.trunc(options.maxColumns ?? Number.MAX_SAFE_INTEGER));
  const ids = new Set(items.map((item) => item.id));
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const depth = new Map<string, number>();
  const resolve = (item: T, trail = new Set<string>()): number => {
    const known = depth.get(item.id);
    if (known !== undefined) return known;
    if (trail.has(item.id)) return 0;
    const parent = parentId(item);
    if (!parent || !ids.has(parent)) { depth.set(item.id, 0); return 0; }
    const parentItem = byId.get(parent);
    const next = parentItem ? resolve(parentItem, new Set(trail).add(item.id)) + 1 : 0;
    depth.set(item.id, next);
    return next;
  };
  for (const item of items) resolve(item);

  const levels = new Map<number, T[]>();
  for (const item of items) {
    const level = depth.get(item.id) ?? 0;
    levels.set(level, [...(levels.get(level) ?? []), item]);
  }
  for (const row of levels.values()) row.sort((a, b) => a.id.localeCompare(b.id));

  const widest = Math.max(1, ...[...levels.values()].map((row) => Math.min(maxColumns, row.length)));
  const span = (widest - 1) * xGap;

  return items.map((item) => {
    const level = depth.get(item.id) ?? 0;
    const row = levels.get(level) ?? [item];
    const index = row.findIndex((entry) => entry.id === item.id);
    const chunk = Math.floor(index / maxColumns);
    const chunkStart = chunk * maxColumns;
    const chunkLength = Math.min(maxColumns, row.length - chunkStart);
    const chunkSpan = (Math.max(1, chunkLength) - 1) * xGap;
    return {
      item,
      depth: level,
      x: startX + (span - chunkSpan) / 2 + (index - chunkStart) * xGap,
      y: startY + (level * 2 + chunk) * yGap,
    };
  });
}

export function layoutUnits(chart: OrganizationChart, options?: OrgLayoutOptions): Positioned<OrganizationUnit>[] {
  const units = [...chart.units].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return layer(units, (unit) => unit.parentUnitId, options);
}

/** Seats of one unit plus the cross-unit parents they report to, so connectors never dangle. */
export function layoutSeats(
  chart: OrganizationChart, unitId: string, options?: OrgLayoutOptions,
): Array<Positioned<OrganizationSeat> & { external: boolean }> {
  const local = chart.seats.filter((seat) => seat.unitId === unitId);
  const localIds = new Set(local.map((seat) => seat.id));
  const outsideParents = new Set(
    local.map((seat) => seat.reportsToSeatId).filter((id): id is string => Boolean(id && !localIds.has(id))),
  );
  const external = chart.seats.filter((seat) => outsideParents.has(seat.id));
  const items = [...external, ...local].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  return layer(items, (seat) => seat.reportsToSeatId, options)
    .map((entry) => ({ ...entry, external: !localIds.has(entry.item.id) }));
}

/** Orthogonal elbow connector: down, across, down. Keeps the chart readable at 320px. */
export function connector(x1: number, y1: number, x2: number, y2: number): string {
  const midY = Math.round((y1 + y2) / 2);
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
}
