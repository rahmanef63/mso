import { IntegrationError, identity, selectConnection, type IntegrationState } from "./identity";
export type IntegrationVariable = { provider: string; user: string; connection: string };
export function variableKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) throw new IntegrationError("invalid_variable_key");
  return value;
}
/** Only absent fields on pre-variable stores are seeded. An explicit empty map disables seeding. */
export function normalizeIntegrationVariables(state: IntegrationState) {
  if (state.variables === undefined) {
    state.variables = {};
    const owners = Object.keys(state.users).filter(user => state.users[user].connections.mcp?.jev);
    const user = state.defaultUser && owners.includes(state.defaultUser) ? state.defaultUser : owners.length === 1 ? owners[0] : undefined;
    if (user) state.variables.JEV = { provider: "mcp", user, connection: "jev" };
  }
  if (!state.variables || typeof state.variables !== "object" || Array.isArray(state.variables)) throw new IntegrationError("invalid_variables");
  for (const [key, ref] of Object.entries(state.variables)) {
    variableKey(key);
    if (!ref || typeof ref !== "object" || Object.keys(ref).sort().join(",") !== "connection,provider,user") throw new IntegrationError("invalid_variable_reference");
    selectConnection(state, identity(ref.provider), { user: identity(ref.user), connection: identity(ref.connection) });
  }
  return state.variables;
}
export function assertNoVariableReferences(state: IntegrationState, user: string, provider?: string, connection?: string) {
  if (Object.values(state.variables ?? {}).some(ref => ref.user === user && (!provider || ref.provider === provider && ref.connection === connection))) throw new IntegrationError("integration_has_variables", 409);
}
