import { listInfraProviderDefinitions } from "./catalog";
import { setupFields, setupGuidance, setupMethods } from "./setup-guidance";
// Pure display metadata only. No imports from credential storage.
export function integrationCatalog() {
  return listInfraProviderDefinitions().map(p => ({
    id: p.id, title: p.title, description: p.description,
    methods: setupMethods(p.id).map(method => ({ ...method, fields: setupFields(p.id, method.id), guidance: setupGuidance(p.id, method.id) })),
  }));
}
