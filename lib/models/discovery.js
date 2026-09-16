import { getCatalog } from './catalog.js'
import { PROVIDERS } from './registry.js'

/** A model is free only when the catalog explicitly reports zero input AND output cost. */
export function isFreeModel(model) {
  const input = model?.cost?.input
  const output = model?.cost?.output
  return Number.isFinite(input) && Number.isFinite(output) && input === 0 && output === 0
}

/** Runtime provider ids stay pinned to MSO's registry; models.dev may use a different catalog id. */
export function providerCatalogId(provider) {
  return PROVIDERS[provider]?.catalogId || provider
}

export function runtimeProviderModels(catalog, provider) {
  const catalogId = providerCatalogId(provider)
  const row = catalog?.[catalogId]
  if (!row || typeof row !== 'object' || Array.isArray(row)) return []
  return Object.entries(row.models || {})
    .filter(([, model]) => model && typeof model === 'object' && !Array.isArray(model))
    .map(([id, model]) => ({ id, model }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function summarizeProvider(catalog, provider) {
  const catalogId = providerCatalogId(provider)
  const catalogProvider = catalog?.[catalogId]
  const models = runtimeProviderModels(catalog, provider)
  const free = models.filter(({ model }) => isFreeModel(model))
  const freeAgent = free.filter(({ model }) => model.tool_call === true)
  return {
    id: provider,
    name: typeof catalogProvider?.name === 'string' && catalogProvider.name.trim() ? catalogProvider.name : provider,
    catalogId,
    modelCount: models.length,
    freeModelCount: free.length,
    freeAgentModelCount: freeAgent.length,
    recommendedFreeModel: (freeAgent[0] || free[0])?.id || null,
  }
}

export function providerSummariesFromCatalog(catalog, { freeOnly = false } = {}) {
  const rows = Object.keys(PROVIDERS).map((provider) => summarizeProvider(catalog, provider))
  const filtered = freeOnly ? rows.filter((row) => row.freeAgentModelCount > 0) : rows
  return filtered.sort((a, b) =>
    (b.freeAgentModelCount > 0 ? 1 : 0) - (a.freeAgentModelCount > 0 ? 1 : 0)
      || b.freeAgentModelCount - a.freeAgentModelCount
      || a.name.localeCompare(b.name)
      || a.id.localeCompare(b.id),
  )
}

export async function listProviderSummaries(options = {}) {
  return providerSummariesFromCatalog(await getCatalog(), options)
}
