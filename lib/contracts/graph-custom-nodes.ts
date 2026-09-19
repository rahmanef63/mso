/** Presentation-only custom nodes. Members retain their original execution identity. */
export type GraphCustomNode = { id: string; name: string; nodeIds: string[]; collapsed: boolean };

export function parseGraphCustomNodes(value: unknown, nodeIds: ReadonlySet<string>): GraphCustomNode[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("custom nodes must be an array of at most 100 groups");
  const groupIds = new Set<string>(), assigned = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid custom node");
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(row.id) || groupIds.has(row.id) || nodeIds.has(row.id)) throw new Error("custom node id is invalid or duplicated");
    if (typeof row.name !== "string" || !row.name.trim() || row.name.length > 120) throw new Error("custom node name is required (120 characters maximum)");
    if (typeof row.collapsed !== "boolean" || !Array.isArray(row.nodeIds) || !row.nodeIds.length || row.nodeIds.length > 200) throw new Error("custom node requires members and a collapsed flag");
    groupIds.add(row.id);
    const members = row.nodeIds.map((id) => {
      if (typeof id !== "string" || !nodeIds.has(id) || assigned.has(id)) throw new Error("custom node members must exist, be unique and belong to only one group");
      assigned.add(id); return id;
    });
    return { id: row.id, name: row.name.trim(), nodeIds: members, collapsed: row.collapsed };
  });
}

/** Explicit node deletion trims membership; it never deletes surviving members. */
export function pruneGraphCustomNodes(groups: GraphCustomNode[] | undefined, ids: ReadonlySet<string>): GraphCustomNode[] {
  return (groups ?? []).map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => ids.has(id)) })).filter((group) => group.nodeIds.length > 0);
}
