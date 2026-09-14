import { expect, it } from "vitest";
import { CONNECTION_MANAGER_SCRIPT } from "./connection-ui";
import { CONNECTION_MANAGER_STYLE } from "./connection-ui-style";

it("uses the Settings master/detail navigation contract", () => {
  expect(CONNECTION_MANAGER_SCRIPT).toContain('aria-label","Integrations sections"');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('integration-settings-sidebar');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('integration-settings-content');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('n("p","Connections","integration-nav-label")');
  expect(CONNECTION_MANAGER_SCRIPT).toContain('n("p","Manage","integration-nav-label")');
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
