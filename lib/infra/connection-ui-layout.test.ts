import { expect, it } from "vitest";
import { CONNECTION_MANAGER_SCRIPT } from "./connection-ui";
import { CONNECTION_MANAGER_STYLE } from "./connection-ui-style";
import { INTEGRATION_BROWSER_SCRIPT } from "./setup-browser";
import { INTEGRATION_FORM_STYLE } from "./setup-ui";

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
  expect(() => new Function(CONNECTION_MANAGER_SCRIPT)).not.toThrow();  expect(CONNECTION_MANAGER_SCRIPT).toContain("same AI runtime/config store as Settings");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("Integration Variables");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("~typesafe/jev-latest");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("same OpenRouter key managed here and in Settings");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("Connect OpenRouter for JEV");
  expect(CONNECTION_MANAGER_SCRIPT).toContain('select:false');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiConfig=()=>json("/api/config")');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiCatalog=()=>json("/api/models/providers")');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.jevStatus=()=>json("/api/v1/jev")');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.jevDecide=body=>json("/api/v1/jev"');
  expect(CONNECTION_MANAGER_SCRIPT).toContain("JEV Lab · bounded decision test");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("JEV Lab never executes tools");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("Actual JEV input / cost · 30d");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("Estimated LLM input / cost avoided · 30d");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("Actual = provider-reported JEV usage");
  expect(CONNECTION_MANAGER_SCRIPT).toContain("Session value capsules");
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiTest=()=>json("/api/models/test"');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiOauth=body=>json("/api/oauth/openai"');
  expect(INTEGRATION_BROWSER_SCRIPT).toContain('bridge.aiRemove=provider=>json("/api/config?provider="');
});

it("exposes the demo-user panel and a reveal-only secret control", () => {
  expect(CONNECTION_MANAGER_SCRIPT).toContain('["demo-users","Demo users",showDemoUsers]');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('operation:"demo.create"');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('operation:"demo.list"');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('operation:"demo.delete"');
  // Reveal is fetched on demand only: one mode, no value carried on panel load.
  expect(CONNECTION_MANAGER_SCRIPT).toContain('"/api/v1/integrations"');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('mode:"reveal"');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('navigator.clipboard.writeText');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('"Revealed. This read is logged."');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('setTimeout(clear,30000)');
  // The demo password is masked until asked for, exactly like a stored key.
  expect(CONNECTION_MANAGER_SCRIPT).toContain('secretControl({demoId:row.id,key:"password"');
});

it("declares the integration container query on .integration so manager, setup, and transfer stay responsive", () => {
  expect(CONNECTION_MANAGER_STYLE).toContain(".integration{container:integration / inline-size");
  expect(CONNECTION_MANAGER_STYLE).not.toContain(".integration.manager{container:integration");
  expect(INTEGRATION_FORM_STYLE).toContain(".integration{container:integration / inline-size");
  expect(INTEGRATION_FORM_STYLE).toContain("@container integration (max-width:37.5rem)");
  expect(INTEGRATION_FORM_STYLE).toMatch(/@container\s+integration[^{]*\{[^}]*\.setup-grid\{[^}]*grid-template-columns:1fr/);
});
