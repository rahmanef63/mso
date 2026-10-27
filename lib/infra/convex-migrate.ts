import { readIntegrationState, mutateIntegrationState } from "./connection-storage";
import { convexMigratedValues } from "./catalog";
import type { IntegrationConnection, IntegrationState } from "./identity";
import { CONVEX_LEGACY_PROVIDER_ID, type ConvexDeploymentKind } from "./types";

/**
 * Forward migration for issue #152: fold every stored `convex-cloud` connection
 * into the single `convex` provider, WITHOUT re-entering a secret.
 *
 * Contract:
 * - explicit — nothing runs at import time and nothing is scheduled;
 * - offline — no network call, ever. A migration that reaches the network cannot
 *   be retried safely after a partial write;
 * - secret-safe — a value moves only between keys the provider schema declares,
 *   and `deploymentKind` is derived from the credential SHAPE (does an `apiUrl`
 *   exist?), never from a credential value;
 * - idempotent — a second run finds no `convex-cloud` rows and reports
 *   `changed: false`, so it writes nothing;
 * - conflict-reporting — when both provider keys already hold the same connection
 *   id, neither row is overwritten and the pair is reported for an operator.
 */

export type ConvexMigrationEntry = {
  user: string;
  connection: string;
  /** Secret KEY NAMES that will move. Never a secret value. */
  secretKeys: string[];
  deploymentKind: ConvexDeploymentKind;
  action: "move" | "conflict";
};
export type ConvexMigrationConflict = ConvexMigrationEntry & { action: "conflict" };
export type ConvexMigrationPlan = {
  changed: boolean;
  /** `true` when the plan can be applied without an operator decision. */
  applicable: boolean;
  entries: ConvexMigrationEntry[];
  conflicts: ConvexMigrationConflict[];
};

const SECRET_KEYS = ["personalToken", "deployKey", "adminKey"] as const;

function legacyRows(state: IntegrationState) {
  const out: { user: string; rows: Record<string, IntegrationConnection> }[] = [];
  for (const [user, profile] of Object.entries(state.users)) {
    const rows = profile.connections?.[CONVEX_LEGACY_PROVIDER_ID];
    if (rows && Object.keys(rows).length) out.push({ user, rows });
  }
  return out;
}

export function planConvexMigration(state: IntegrationState | null): ConvexMigrationPlan {
  if (!state) return { changed: false, applicable: true, entries: [], conflicts: [] };
  const entries: ConvexMigrationEntry[] = [];
  for (const { user, rows } of legacyRows(state)) {
    const existing = state.users[user]?.connections.convex ?? {};
    for (const [connection, row] of Object.entries(rows)) {
      const values = row.values ?? {};
      entries.push({
        user,
        connection,
        secretKeys: SECRET_KEYS.filter((key) => Boolean(values[key])),
        deploymentKind: values.apiUrl ? "self-hosted" : "cloud",
        action: Object.hasOwn(existing, connection) ? "conflict" : "move",
      });
    }
  }
  const conflicts = entries.filter((entry): entry is ConvexMigrationConflict => entry.action === "conflict");
  return { changed: entries.length > 0, applicable: conflicts.length === 0, entries, conflicts };
}

/** Dry run: reports what WOULD move. Reads only; writes nothing. */
export async function dryRunConvexMigration(): Promise<ConvexMigrationPlan> {
  return planConvexMigration(await readIntegrationState());
}

/**
 * Apply the migration. Refuses as a whole when any conflict is present, because a
 * partial fold could silently drop one of the two colliding connections.
 */
export async function migrateConvexConnections(): Promise<ConvexMigrationPlan> {
  const before = planConvexMigration(await readIntegrationState());
  if (!before.changed) return before;
  if (!before.applicable)
    throw Object.assign(new Error("convex_migration_conflict"), {
      code: "convex_migration_conflict",
      status: 409,
      conflicts: before.conflicts,
    });
  return mutateIntegrationState((state) => {
    const plan = planConvexMigration(state);
    for (const entry of plan.entries) {
      const profile = state.users[entry.user];
      const row = profile?.connections[CONVEX_LEGACY_PROVIDER_ID]?.[entry.connection];
      if (!profile || !row) continue;
      const values = convexMigratedValues(row.values);
      profile.connections.convex = {
        ...(profile.connections.convex ?? {}),
        [entry.connection]: {
          ...row,
          id: entry.connection,
          provider: "convex",
          authMethod: values.deploymentKind === "self-hosted" ? "admin" : row.authMethod === "deployment" ? "deployment" : "personal",
          values,
        },
      };
      if (profile.defaults[CONVEX_LEGACY_PROVIDER_ID] === entry.connection && !profile.defaults.convex)
        profile.defaults.convex = entry.connection;
    }
    // Drop the legacy key only when every row moved. A leftover row is a conflict,
    // already refused above, so this cannot silently lose a connection.
    for (const profile of Object.values(state.users)) {
      const rows = profile.connections[CONVEX_LEGACY_PROVIDER_ID];
      if (!rows) continue;
      const remaining = Object.fromEntries(Object.entries(rows).filter(([id]) => !profile.connections.convex?.[id]));
      if (Object.keys(remaining).length) profile.connections[CONVEX_LEGACY_PROVIDER_ID] = remaining;
      else delete profile.connections[CONVEX_LEGACY_PROVIDER_ID];
      if (!profile.connections[CONVEX_LEGACY_PROVIDER_ID] && profile.defaults[CONVEX_LEGACY_PROVIDER_ID])
        delete profile.defaults[CONVEX_LEGACY_PROVIDER_ID];
    }
    // Folder bindings point at the provider id too; carry them across so a bound
    // project keeps resolving without the operator re-mapping it.
    for (const binding of state.bindings) {
      const bound = binding.connections[CONVEX_LEGACY_PROVIDER_ID];
      if (bound === undefined) continue;
      if (binding.connections.convex === undefined) binding.connections.convex = bound;
      delete binding.connections[CONVEX_LEGACY_PROVIDER_ID];
    }
    return plan;
  });
}
