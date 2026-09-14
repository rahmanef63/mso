import { IntegrationError, identity, type IntegrationState } from "../identity";

export type TransferSelection = { user: string; provider?: string; connection?: string };
const MAX_SELECTIONS = 512;

export function normalizeTransferSelection(value: unknown): TransferSelection[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SELECTIONS) throw new IntegrationError("invalid_transfer_selection");
  const seen = new Set<string>();
  const out: TransferSelection[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new IntegrationError("invalid_transfer_selection");
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).some(key => !["user", "provider", "connection"].includes(key))) throw new IntegrationError("invalid_transfer_selection");
    const user = identity(row.user, "user");
    const provider = row.provider === undefined ? undefined : identity(row.provider, "provider");
    const connection = row.connection === undefined ? undefined : identity(row.connection, "connection");
    if (connection && !provider) throw new IntegrationError("invalid_transfer_selection");
    const key = [user, provider ?? "*", connection ?? "*"].join("/");
    if (!seen.has(key)) { seen.add(key); out.push({ user, ...(provider ? { provider } : {}), ...(connection ? { connection } : {}) }); }
  }
  return out.sort((a,b) => `${a.user}/${a.provider ?? ""}/${a.connection ?? ""}`.localeCompare(`${b.user}/${b.provider ?? ""}/${b.connection ?? ""}`));
}

export function transferSelectionMatches(selection: TransferSelection[] | undefined, user: string, provider: string, connection: string) {
  if (!selection) return true;
  return selection.some(row => row.user === user && (!row.provider || row.provider === provider) && (!row.connection || row.connection === connection));
}

export function assertTransferSelectionExists(state: IntegrationState, selection: TransferSelection[] | undefined) {
  if (!selection) return;
  for (const row of selection) {
    const profile = state.users[row.user];
    if (!profile) throw new IntegrationError("unknown_export_user",404);
    if (row.provider && !profile.connections[row.provider]) throw new IntegrationError("unknown_export_provider",404);
    if (row.connection && !profile.connections[row.provider!]?.[row.connection]) throw new IntegrationError("unknown_export_connection",404);
  }
}
