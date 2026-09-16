export type CatModel = {
  ref: string;
  id: string;
  name?: string;
  context?: number;
  inputCost?: number;
  outputCost?: number;
  tools?: boolean;
  free?: boolean;
  agentReady?: boolean;
  reasoning?: boolean;
  vision?: boolean;
};

export type ModelFilters = {
  free: boolean;
  tools: boolean;
  reasoning: boolean;
  vision: boolean;
  minContext: number;
};

export type ModelSort = "best" | "price" | "capability" | "context";

export const modelCost = (m: CatModel) => (m.inputCost ?? 9999) + (m.outputCost ?? 9999);

export function modelPower(m: CatModel): number {
  return (m.context ?? 0) / 1000 + (m.tools ? 50 : 0) + (m.reasoning ? 40 : 0) + (m.vision ? 25 : 0);
}

export function filterAndSortModels(models: CatModel[], query: string, filters: ModelFilters, sort: ModelSort): CatModel[] {
  const q = query.trim().toLowerCase();
  const pass = (m: CatModel) =>
    (!q || m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q)) &&
    (!filters.free || m.free === true) &&
    (!filters.tools || !!m.tools) &&
    (!filters.reasoning || !!m.reasoning) &&
    (!filters.vision || !!m.vision) &&
    (!filters.minContext || (m.context ?? 0) >= filters.minContext);

  const score = (m: CatModel) => modelPower(m) / Math.max(modelCost(m), 0.01);
  return models.filter(pass).sort((a, b) => {
    if (sort === "price") return modelCost(a) - modelCost(b) || Number(!!b.agentReady) - Number(!!a.agentReady) || a.id.localeCompare(b.id);
    if (sort === "capability") return modelPower(b) - modelPower(a) || a.id.localeCompare(b.id);
    if (sort === "context") return (b.context ?? 0) - (a.context ?? 0) || a.id.localeCompare(b.id);
    return score(b) - score(a) || Number(!!b.free) - Number(!!a.free) || a.id.localeCompare(b.id);
  });
}
