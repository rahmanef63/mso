export type SkillMarketState = "not-installed" | "installed" | "update-available" | "modified" | "conflict";
export type SkillMarketRow = {
  id: string; title: string; description: string; version: string; source: string;
  security: string; state: SkillMarketState; revision: string;
  canInstall: boolean; canRemove: boolean;
};
export type SkillMarketSnapshot = { catalogVersion: number; root: string; skills: SkillMarketRow[] };
