import { expect, it } from "vitest";
import { CONNECTION_MANAGER_SCRIPT } from "./connection-ui";
import { CONNECTION_MANAGER_STYLE } from "./connection-ui-style";
import { INTEGRATION_BROWSER_SCRIPT } from "./setup-browser";

it("uses the Settings master/detail navigation contract", () => {
  expect(CONNECTION_MANAGER_SCRIPT).toContain('aria-label","Integrations sections"');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('integration-settings-sidebar');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('integration-settings-content');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('n("p","Connections","integration-nav-label")');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('n("p","Manage","integration-nav-label")');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('["ai-providers","AI Providers",showAiProviders]');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('["variables","Variables",showVariables]');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('["transfer","Transfer & backup",showTransfer]');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('["project-mcp","Add project MCP",showProjectMcp]');
  expect(CONNECTION_MANAGER_STYLE).toContain('grid-template-columns:var(--settings-sidebar-width) minmax(0,1fr)');
  expect(CONNECTION_MANAGER_STYLE).toContain('width:min(100%,var(--settings-content-width))');
  expect(CONNECTION_MANAGER_STYLE).toContain('@container integration (max-width:37.5rem)');
  expect(CONNECTION_MANAGER_STYLE).toContain('integration-sidebar-toggle');
});

it("keeps transfer inside the selected detail pane when the browser bridge supports it", () => {
  expect(CONNECTION_MANAGER_SCRIPT).toContain('bridge.mountTransfer(detail');
});

it("keeps AI Providers on the existing AI config/runtime SSOT and browser-only credential bridge", () => {
  expect(() => new Function(CONNECTION_MANAGER_SCRIPT)).not.toThrow();
  expect(CONNECTION_MANAGER_SCRIPT).toContain("same AI runtime/config store as Settings");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("Integration Variables");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("~typesafe/jev-latest");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("same OpenRouter key managed here and in Settings");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("Connect OpenRouter for JEV");
  expect(CONNECTION_MANAGER_SCRIPT).toContain('select:false');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiConfig=()=>json("/api/config")');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiCatalog=()=>json("/api/models/providers")');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiTest=()=>json("/api/models/test"');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiOauth=body=>json("/api/oauth/openai"');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiRemove=provider=>json("/api/config?provider="');
});
