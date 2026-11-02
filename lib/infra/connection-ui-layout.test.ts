import { expect, it } from "vitest";
import { CONNECTION_MANAGER_SCRIPT } from "./connection-ui";
import { CONNECTION_MANAGER_STYLE } from "./connection-ui-style";
import { INTEGRATION_FORM_STYLE } from "./setup-ui";
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

// Responsiveness in the integrations page depends on one container query. Its declaration used to
// live on ".integration.manager", but the setup form and the transfer view both drop that class
// before mounting, so the @container rule was dead CSS and .setup-grid stayed two columns at 320px.
it("declares the integration container query on .integration so manager, setup, and transfer stay responsive", () => {
  expect(CONNECTION_MANAGER_STYLE).toContain(".integration{container:integration / inline-size");
  expect(CONNECTION_MANAGER_STYLE).not.toContain(".integration.manager{container:integration");
  expect(INTEGRATION_FORM_STYLE).toContain(".integration{container:integration / inline-size");
  expect(INTEGRATION_FORM_STYLE).toContain("@container integration (max-width:37.5rem)");
});

// Swap the logo and nothing changes is the antislop identity test failing. The embedded surface
// hid the only real logo behind ".site-bar{display:none}" and drew a letter "M" instead.
it("renders the authentic MSO logo mark instead of a fallback initial", () => {
  expect(CONNECTION_MANAGER_SCRIPT).toContain('aria-hidden');
  expect(CONNECTION_MANAGER_SCRIPT).not.toContain('n("span","M","integration-brand-icon")');
  expect(CONNECTION_MANAGER_STYLE).toContain("width:var(--brand-size)");
});

// A revealed credential is the most sensitive thing on this page. Its classes had no CSS at all,
// so a 40 to 60 character token could burst the card on a narrow viewport.
it("styles credential secret controls with safe overflow and tap targets", () => {
  expect(CONNECTION_MANAGER_STYLE).toContain(".identity-secret{");
  expect(CONNECTION_MANAGER_STYLE).toContain(".identity-secret-value{");
  expect(CONNECTION_MANAGER_STYLE).toContain(".identity-secret-toggle{");
  expect(CONNECTION_MANAGER_STYLE).toContain(".identity-secret-copy{");
  expect(CONNECTION_MANAGER_STYLE).toMatch(/\.identity-secret-value\{[^}]*overflow-wrap:anywhere/);
  expect(CONNECTION_MANAGER_STYLE).toMatch(/\.identity-secret-value\{[^}]*word-break:break-word/);
  expect(CONNECTION_MANAGER_STYLE).toMatch(/\.identity-secret-toggle\{[^}]*min-height:var\(--control-size\)/);
});

// A page with no h1 and two nested <main> landmarks gives a screen reader no orientation.
it("keeps one main landmark and one page heading without nesting", () => {
  expect(CONNECTION_MANAGER_SCRIPT).not.toMatch(/n\(\s*["']main["']/);
  expect(CONNECTION_MANAGER_SCRIPT).toContain('n("section",undefined,"integration-settings-content")');
  expect(CONNECTION_MANAGER_SCRIPT).toContain("bridge&&bridge.headingLevel||1");
});

// The sidebar must close with the same control that opened it, must not pull up the mobile
// keyboard on open, and must not let Tab escape behind the backdrop.
it("toggles the sidebar both ways, focuses the panel, and traps focus", () => {
  expect(CONNECTION_MANAGER_SCRIPT).toContain('()=>setSidebar(!sidebarOpen)');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('sidebarPanel.tabIndex=-1');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('content.inert=sidebarOpen');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('event.key==="Tab"&&sidebarOpen');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('ResizeObserver');
});

it("supports bidirectional sidebar toggle, panel focus, inert content trap, and full nav search", () => {
  // 1. Toggle toggles sidebar (opens and closes)
  expect(CONNECTION_MANAGER_SCRIPT).toContain('sidebarToggle=b("Integrations sections",()=>setSidebar(!sidebarOpen)');
  expect(CONNECTION_MANAGER_SCRIPT).not.toContain('()=>setSidebar(true)');

  // 2. Focuses panel with tabindex="-1" instead of first input
  expect(CONNECTION_MANAGER_SCRIPT).toContain('sidebarPanel.tabIndex=-1');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('if(sidebarOpen)setTimeout(()=>sidebarPanel?.focus(),0)');
  expect(CONNECTION_MANAGER_SCRIPT).not.toContain('sidebarPanel?.querySelector("input,button")?.focus()');

  // 3. Inert content and Tab trap
  expect(CONNECTION_MANAGER_SCRIPT).toContain('content.inert=sidebarOpen');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('content.setAttribute("inert","")');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('event.key==="Tab"&&sidebarOpen');

  // 4. Reset aria-expanded when container width exceeds 37.5rem
  expect(CONNECTION_MANAGER_SCRIPT).toContain('ResizeObserver');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('if(width>37.5*rem)');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('sidebarToggle.setAttribute("aria-expanded","false")');

  // 5. Short iframe responsiveness: header flex:none with max-height, nav min-height
  expect(CONNECTION_MANAGER_STYLE).toContain('.integration .integration-sidebar-header{display:grid;flex:none;max-height:calc(var(--control-size) * 4);overflow-y:auto;');
  expect(CONNECTION_MANAGER_STYLE).toContain('.integration .integration-settings-nav{min-height:calc(var(--control-size) * 2);flex:1;overflow-y:auto;');

  // 6. Search filters all nav items, including Manage utilities
  expect(CONNECTION_MANAGER_SCRIPT).toContain('navButtons.push({mode,provider:null,button:item,label})');
  expect(CONNECTION_MANAGER_SCRIPT).not.toContain('if(entry.mode!=="provider")continue');
});

it("uses explicit provider selection in folder bindings instead of the active sidebar provider (Poin 1)", () => {
  expect(CONNECTION_MANAGER_SCRIPT).not.toContain("{provider:provider.id,connection:connection.input.value}");
  expect(CONNECTION_MANAGER_SCRIPT).toContain('providerLabel=n("label","Provider (optional)")');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('providerSelect=n("select")');
  expect(CONNECTION_MANAGER_SCRIPT).toContain("provider:pId,connection:cId");
});

it("enforces empty and loading states in bindings and demo users (Poin 2, R-27)", () => {
  // Empty state for bindings
  expect(CONNECTION_MANAGER_SCRIPT).toContain('"No folder bindings yet"');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('identity-empty');
  // Loading state for demo users
  expect(CONNECTION_MANAGER_SCRIPT).toContain('"Loading demo users…"');
});

it("explains why hosted authorization is disabled when already linked (Poin 3, R-26)", () => {
  expect(CONNECTION_MANAGER_SCRIPT).toContain('authorize.title="Already linked to "+c.external.connectedAccountId');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('"Already linked to "+c.external.connectedAccountId');
});
