import { describe, expect, it } from "vitest";
import { isOpenAiAppBindingId, validateOpenAiAppManifest } from "./openai-app-binding";

describe("OpenAI app binding compatibility", () => {
  it.each([
    "asdk_app_6a834fa9d250819197e75b23fe1223da",
    "connector_76869538009648d5b282a4bb21c3d157",
    "connector_openai_plugin_management",
    "templated_apps_example_connector-v2",
  ])("accepts canonical app/connector binding ids: %s", (id) => {
    expect(isOpenAiAppBindingId(id)).toBe(true);
  });

  it.each([
    "plugin_asdk_app_6a834fa9d250819197e75b23fe1223da",
    "unknown_abc123",
    "asdk_app_",
    "connector_bad value",
  ])("rejects non-canonical or malformed ids: %s", (id) => {
    expect(isOpenAiAppBindingId(id)).toBe(false);
  });

  it("accepts required, optional, snake_case aliases, and reference metadata", () => {
    expect(validateOpenAiAppManifest({ apps: { mso: { id: "asdk_app_abc123", required: true } } }).ok).toBe(true);
    expect(validateOpenAiAppManifest({ apps: { github: { id: "connector_abc123", required: false } } }).ok).toBe(true);
    expect(validateOpenAiAppManifest({
      apps: {
        google_calendar: {
          id: "connector_947e0d954944416db111db556030eea6",
          optional: true,
          category: "Calendar context",
        },
      },
    }).ok).toBe(true);
    expect(validateOpenAiAppManifest({ apps: { plugin_management: { id: "connector_openai_plugin_management" } } }).ok).toBe(true);
  });

  it("accepts an empty app map for skill-only packages", () => {
    expect(validateOpenAiAppManifest({ apps: {} }).ok).toBe(true);
  });

  it.each([
    { apps: { github: { id: "REPLACE_WITH_APP_ID", required: true } } },
    { apps: { github: { id: "plugin_asdk_app_abc123", required: true } } },
    { apps: { github: { id: "connector_abc123", required: "false" } } },
    { apps: { github: { id: "connector_abc123", optional: "true" } } },
    { apps: { github: { id: "unknown_abc123", required: false } } },
    { apps: { "Bad Key": { id: "connector_abc123", required: false } } },
  ])("rejects placeholders, malformed ids, keys, or non-boolean dependency state", (manifest) => {
    expect(validateOpenAiAppManifest(manifest).ok).toBe(false);
  });
});
