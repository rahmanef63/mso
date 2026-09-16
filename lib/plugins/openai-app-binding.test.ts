import { describe, expect, it } from "vitest";
import { isOpenAiAppBindingId, validateOpenAiAppManifest } from "./openai-app-binding";

describe("OpenAI app binding compatibility", () => {
  it.each([
    "asdk_app_6a834fa9d250819197e75b23fe1223da",
    "plugin_asdk_app_6a834fa9d250819197e75b23fe1223da",
    "connector_76869538009648d5b282a4bb21c3d157",
    "templated_apps_example_connector",
  ])("accepts supported app/connector binding ids: %s", (id) => {
    expect(isOpenAiAppBindingId(id)).toBe(true);
  });

  it("accepts required registered apps and optional connectors", () => {
    expect(validateOpenAiAppManifest({ apps: { mso: { id: "asdk_app_abc123", required: true } } }).ok).toBe(true);
    expect(validateOpenAiAppManifest({ apps: { github: { id: "connector_abc123", required: false } } }).ok).toBe(true);
  });

  it("accepts an empty app map for skill-only packages", () => {
    expect(validateOpenAiAppManifest({ apps: {} }).ok).toBe(true);
  });

  it.each([
    { apps: { github: { id: "REPLACE_WITH_APP_ID", required: true } } },
    { apps: { github: { id: "connector_abc123" } } },
    { apps: { github: { id: "connector_abc123", required: "false" } } },
    { apps: { github: { id: "unknown_abc123", required: false } } },
    { apps: { "Bad Key": { id: "connector_abc123", required: false } } },
  ])("rejects placeholders, malformed ids, keys, or non-boolean dependency state", (manifest) => {
    expect(validateOpenAiAppManifest(manifest).ok).toBe(false);
  });
});
