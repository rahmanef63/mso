import { describe, expect, it } from "vitest";
import { getInfraProviderDefinition, normalizeInfraValues } from "./catalog";
import { doctorAdditionalProvider } from "./additional-doctor";
import { connectionMethods } from "./connection-registry";

describe("OpenAI registered app integration", () => {
  it("is a private direct Integrations provider", () => {
    const def=getInfraProviderDefinition("openai-app");
    expect(def.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"appId",secret:true,required:true}),
    ]));
    expect(connectionMethods("openai-app","direct")[0].guidance.steps.join(" ")).toContain("App ID");
  });

  it("normalizes browser plugin ids and ignores version-scoped metadata", () => {
    expect(normalizeInfraValues("openai-app",{appId:"plugin_asdk_app_example123",versionId:"asdk_app_v_example456"})).toEqual({
      appId:"asdk_app_example123",
    });
    expect(()=>normalizeInfraValues("openai-app",{appId:"asdk_app_v_wrong"})).toThrow();
  });

  it("verifies only local identifier format without claiming remote review state", async () => {
    await expect(doctorAdditionalProvider("openai-app",{appId:"asdk_app_example123"})).resolves.toContain("ChatGPT remains authoritative");
  });
});
