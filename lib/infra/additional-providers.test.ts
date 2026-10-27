import { describe, expect, it } from "vitest";
import { ADDITIONAL_GUIDANCE, ADDITIONAL_PROVIDERS } from "./additional-providers";
import { getInfraProviderDefinition } from "./catalog";
import { INFRA_PROVIDER_IDS } from "./types";
import { setupFields, setupMethods } from "./setup-guidance";

describe("one Convex provider definition", () => {
  it("is a single entry that accepts BOTH credential shapes", () => {
    expect(Object.keys(ADDITIONAL_PROVIDERS).filter((id) => id.includes("convex"))).toEqual(["convex"]);
    const fields = getInfraProviderDefinition("convex").fields;
    const keys = fields.map((field) => field.key);
    // Cloud shape + self-hosted shape live in ONE schema.
    expect(keys).toEqual(["deploymentKind", "personalToken", "deployKey", "deploymentName", "apiUrl", "adminKey"]);
    expect(fields.filter((field) => field.secret).map((field) => field.key)).toEqual(["personalToken", "deployKey", "adminKey"]);
    expect(fields.find((field) => field.key === "deploymentKind")?.secret).toBe(false);
  });

  it("keeps the existing method ids so a connection still declares HOW it authenticates", () => {
    expect(setupMethods("convex").map((method) => method.id)).toEqual(["personal", "deployment", "admin"]);
    expect(setupFields("convex", "personal").map((field) => field.key)).toEqual(["personalToken"]);
    expect(setupFields("convex", "deployment").map((field) => field.key)).toEqual(["deployKey", "deploymentName"]);
    expect(setupFields("convex", "admin").map((field) => field.key)).toEqual(["apiUrl", "adminKey"]);
    expect(() => setupFields("convex", "organization")).toThrow();
  });

  it("is the only convex id in the provider list, with a read alias for the old one", () => {
    expect(INFRA_PROVIDER_IDS.filter((id) => id.startsWith("convex"))).toEqual(["convex"]);
    // Guidance exists for the surviving id, not the retired one.
    expect(ADDITIONAL_GUIDANCE).toHaveProperty("convex");
    expect(ADDITIONAL_GUIDANCE).not.toHaveProperty("convex-cloud");
    expect(ADDITIONAL_GUIDANCE.convex.steps.length).toBeGreaterThan(1);
  });
});
