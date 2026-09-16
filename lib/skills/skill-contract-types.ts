export type SkillContractMode = "read" | "write" | "execute" | "mixed";
export type SkillContractSourceOfTruth = "live" | "local" | "snapshot" | "mixed";
export type SkillContractRefresh = "always" | "before-write" | "contextual";
export type SkillContractConfirmation = "none" | "contextual" | "explicit";
export type SkillContractConcurrency = "none" | "hash" | "revision" | "compare" | "contextual";
export type SkillContractPresentationAuthority = "tool" | "model" | "hybrid";

export type SkillContract = {
  version: 1;
  routing: {
    use_when: string[];
    do_not_use_when: string[];
    fallback?: boolean;
    prefer_over?: string[];
    handoff_to?: string[];
  };
  context: {
    target: string;
    mode: SkillContractMode;
    actor?: string;
  };
  lifecycle?: {
    discover?: string[];
    validate?: string[];
    verify?: string[];
  };
  state?: {
    source_of_truth: SkillContractSourceOfTruth;
    refresh: SkillContractRefresh;
  };
  safety?: {
    risk: "low" | "medium" | "high";
    confirmation: SkillContractConfirmation;
    concurrency: SkillContractConcurrency;
  };
  presentation?: {
    authority: SkillContractPresentationAuthority;
    renderer?: string;
  };
};
