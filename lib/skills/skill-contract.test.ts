import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { parseSkillContract, compactSkillContract } = await import("./skill-contract");
const { validateSkillArtifact, skillArtifactValidatorIds } = await import("./skill-artifact-validators");

const contract = {
  version: 1,
  routing: { use_when: ["write guarded text"], do_not_use_when: ["binary data"], fallback: false },
  context: { target: "filesystem-text", mode: "write", actor: "operator" },
  lifecycle: { discover: ["fs_read"], validate: ["sha256-cas"], verify: ["fs_read"] },
  state: { source_of_truth: "live", refresh: "before-write" },
  safety: { risk: "medium", confirmation: "contextual", concurrency: "hash" },
  presentation: { authority: "hybrid" },
};

describe("structured skill artifacts", () => {
  it("parses and compacts the portable contract without weakening its safety fields", () => {
    const parsed = parseSkillContract(contract);
    expect(parsed.safety).toEqual({ risk: "medium", confirmation: "contextual", concurrency: "hash" });
    expect(compactSkillContract(parsed)).toMatchObject({ target: "filesystem-text", mode: "write", risk: "medium", concurrency: "hash" });
  });

  it("fails closed on invalid contract enums and validates OpenAI skill descriptors locally", () => {
    expect(() => parseSkillContract({ ...contract, safety: { ...contract.safety, concurrency: "provider" } })).toThrow(/concurrency/);
    expect(skillArtifactValidatorIds()).toEqual(["skill-contract-v1", "openai-skill-interface-v1"]);
    expect(validateSkillArtifact("openai-skill-interface-v1", {
      interface: { display_name: "MSO", short_description: "Operate MSO", default_prompt: "Use $mso." },
    })).toMatchObject({ ok: true });
    expect(validateSkillArtifact("openai-skill-interface-v1", { interface: { display_name: "MSO" } })).toMatchObject({ ok: false });
  });
});
