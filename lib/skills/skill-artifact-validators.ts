import { parseSkillContract } from "./skill-contract";

export type SkillArtifactKind = "skill-contract-v1" | "openai-skill-interface-v1";
export type SkillArtifactValidation = { ok: true; value: unknown } | { ok: false; errors: string[] };

type Validator = (value: unknown) => unknown;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function validateOpenAiSkillInterface(value: unknown) {
  if (!object(value)) throw new Error("OpenAI skill descriptor must be an object");
  if (!object(value.interface)) throw new Error("OpenAI skill descriptor requires interface");
  const required = ["display_name", "short_description", "default_prompt"] as const;
  for (const key of required) {
    const field = value.interface[key];
    if (typeof field !== "string" || !field.trim()) throw new Error(`interface.${key} must be a non-empty string`);
  }
  if (value.interface.brand_color !== undefined && (typeof value.interface.brand_color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.interface.brand_color))) {
    throw new Error("interface.brand_color must be a six-digit hex color when provided");
  }
  return value;
}

const REGISTRY: Record<SkillArtifactKind, Validator> = {
  "skill-contract-v1": parseSkillContract,
  "openai-skill-interface-v1": validateOpenAiSkillInterface,
};

export function skillArtifactValidatorIds(): SkillArtifactKind[] {
  return Object.keys(REGISTRY) as SkillArtifactKind[];
}

export function validateSkillArtifact(kind: SkillArtifactKind, value: unknown): SkillArtifactValidation {
  try {
    return { ok: true, value: REGISTRY[kind](value) };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}
