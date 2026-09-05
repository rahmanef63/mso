import { inlineScripts } from "../../scripts/test-support/inline-scripts";
import { describe, expect, it } from "vitest";
import { LEGACY_PAGE_V2_URI, LEGACY_PAGE_V3_URI, LEGACY_PAGE_V9_URI, MSO_PAGE_URI, listUiResources, readUiResource } from "./ui-resources";

describe("MCP Page lifecycle and cached resource migration", () => {
  it("serves current bytes to cached v2 clients without advertising a third UI", () => {
    const page = readUiResource(MSO_PAGE_URI);
    expect(readUiResource(LEGACY_PAGE_V2_URI)).toMatchObject({ uri: LEGACY_PAGE_V2_URI, text: page?.text });
    expect(readUiResource(LEGACY_PAGE_V3_URI)).toMatchObject({ uri: LEGACY_PAGE_V3_URI, text: page?.text });
    expect(readUiResource(LEGACY_PAGE_V9_URI)).toMatchObject({ uri: LEGACY_PAGE_V9_URI, text: page?.text });
    expect(listUiResources()).toHaveLength(2);
    expect(listUiResources().some((resource) => resource.uri === LEGACY_PAGE_V2_URI)).toBe(false);
  });
  it("includes the Apps handshake and readiness contract in valid self-contained JavaScript", () => {
    const html = readUiResource(MSO_PAGE_URI)?.text ?? "";
    const script = inlineScripts(html)[0];
    expect(script).toBeTruthy();
    expect(() => new Function(script ?? "")).not.toThrow();
    for (const marker of [
      'rpcRequest("ui/initialize"',
      'appInfo:{name:"MSO Page",version:"3.0.0"}',
      'method:"ui/notifications/initialized"',
      'event.source!==window.parent',
      'event.source!==frame.contentWindow||event.origin!==safe.origin',
      'data.type!=="play-together:embed-ready"||data.schemaVersion!==1',
      'if(key===lastOutputKey){',
      'setTimeout(unavailable,12000)',
      'hostMax*.48',
      'availableDisplayModes:["inline","fullscreen","pip"]',
    ]) expect(script).toContain(marker);
    expect(html).toContain('html[data-display-mode="inline"] .surface');
    expect(html).toContain('max-height:var(--inline-max-h)');
    expect(html).toContain('html[data-display-mode="fullscreen"] .surface{height:100vh;height:100dvh');
    expect(html).not.toContain('presentation:"fullscreen"');
  });
});
