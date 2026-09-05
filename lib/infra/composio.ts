import type { InfraProviderValues } from "./types";
import { readInfraProvider } from "./store";
import { request } from "./http";

const API = "https://backend.composio.dev/api/v3.1";
export async function doctorComposio(candidate?: InfraProviderValues): Promise<string | null> {
  const values = candidate ?? await readInfraProvider("composio");
  const key = values.apiKey;
  const orgKey = values.orgApiKey;
  if (!key && !orgKey) return null;
  const target = orgKey ? "/org/project/list" : "/tools?limit=1";
  const header: Record<string, string> = orgKey ? { "x-org-api-key": orgKey } : { "x-api-key": key! };
  const response = await request(`${API}${target}`, { headers: header });
  if (!response.ok) throw new Error(`Composio validation failed (${response.status})`);
  return orgKey ? "Composio organization key accepted" : "Composio project key accepted";
}
