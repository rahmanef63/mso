import { describe, expect, it } from "vitest";
import { CONNECTION_MANAGER_SCRIPT } from "./connection-ui";
import { CONNECTION_MANAGER_STYLE } from "./connection-ui-style";
import { CONNECTION_ADDRESS_SCRIPT } from "./connection-ui-address";
import { INTEGRATION_BROWSER_SCRIPT } from "./setup-browser";

// A connection used to be describable only in prose ("the github one under studio"),
// which forced the operator to translate before an agent could act. The address makes
// provider + owner + connection one copyable value, and it is a real route.
describe("copyable connection address", () => {
  it("builds the address from all three coordinates the agent needs", () => {
    expect(CONNECTION_ADDRESS_SCRIPT).toContain("connectionAddressHref");
    expect(CONNECTION_ADDRESS_SCRIPT).toContain("provider:String(row.provider)");
    expect(CONNECTION_ADDRESS_SCRIPT).toContain('user:String(row.user||owner||"")');
    expect(CONNECTION_ADDRESS_SCRIPT).toContain("connection:String(row.id)");
    expect(CONNECTION_ADDRESS_SCRIPT).toContain('"/integrations?"+params.toString()');
  });

  it("offers a copy control labelled for the address, not a generic copy", () => {
    expect(CONNECTION_ADDRESS_SCRIPT).toContain('"Copy connection address"');
    expect(CONNECTION_ADDRESS_SCRIPT).toContain("navigator.clipboard.writeText");
    expect(CONNECTION_MANAGER_SCRIPT).toContain("addressControl.row(c,user)");
  });

  // The visible text stays short; the copied and titled value is absolute, because an
  // agent needs a route, and hover should answer "where does this go" without copying.
  it("keeps the short label visible and the absolute route in the copied value", () => {
    expect(CONNECTION_ADDRESS_SCRIPT).toContain('"connection-address-value"');
    expect(CONNECTION_ADDRESS_SCRIPT).toContain("value.title=location.origin+connectionAddressHref(row,owner)");
    expect(CONNECTION_ADDRESS_SCRIPT).toContain('location.origin+connectionAddressHref(row,owner)');
  });
});

// Landing is the other half: an address that selects the provider but not the account is
// just a longer way to navigate. It must also fire exactly once.
describe("connection address landing", () => {
  it("marks the addressed card and moves focus to it", () => {
    expect(CONNECTION_ADDRESS_SCRIPT).toContain('card.dataset.addressed="true"');
    expect(CONNECTION_ADDRESS_SCRIPT).toContain("scrollIntoView");
    expect(CONNECTION_ADDRESS_SCRIPT).toContain('setAttribute("tabindex","-1")');
  });

  it("reads the connection selector from the route", () => {
    expect(INTEGRATION_BROWSER_SCRIPT).toContain('params.get("connection")');
    expect(INTEGRATION_BROWSER_SCRIPT).toContain("connection:params.get(\"connection\")");
  });

  // A redraw happens on every reload and every owner switch. Without a pending guard the
  // card would be re-addressed each time and fight the operator.
  it("consumes the pending address once, and only when rows exist", () => {
    expect(CONNECTION_MANAGER_SCRIPT).toContain("addressedPending=initial.connection||null");
    expect(CONNECTION_MANAGER_SCRIPT).toContain("if(rows.length){addressControl.reveal(rows,addressedPending);addressedPending=null}");
  });

  // Silently showing the provider for a dead address would look like the link worked.
  it("says so when the address no longer matches a connection", () => {
    expect(CONNECTION_ADDRESS_SCRIPT).toContain("no longer matches a connection for this owner");
  });
});

// The address is long and has no spaces, which is exactly the shape that bursts a card.
describe("connection address layout", () => {
  it("wraps the address value instead of widening the card", () => {
    expect(CONNECTION_MANAGER_STYLE).toMatch(/\.connection-address-value\{[^}]*overflow-wrap:anywhere/);
    expect(CONNECTION_MANAGER_STYLE).toMatch(/\.connection-address-value\{[^}]*word-break:break-word/);
    expect(CONNECTION_MANAGER_STYLE).toMatch(/\.connection-address\{[^}]*grid-template-columns:auto minmax\(0,1fr\) auto/);
  });

  it("drops the redundant visible label where space is short", () => {
    expect(CONNECTION_MANAGER_STYLE).toContain(".integration .connection-address-label{display:none}");
  });

  // Highlight is a border plus a ring, both from shared tokens, so it reads in both themes
  // and does not rely on colour alone (the heading also receives focus).
  it("marks the addressed card with token-driven emphasis", () => {
    expect(CONNECTION_MANAGER_STYLE).toContain(".integration .connection-card[data-addressed=true]{border-color:var(--primary)");
  });
});

// The owner picker used to be one run-on string: "Studio · studio · default". Three
// different facts in one blob made the operator ask which part was the name.
describe("credential owner picker", () => {
  it("renders label, id and default as separate facts", () => {
    expect(CONNECTION_MANAGER_SCRIPT).toContain("owner-picker-name");
    expect(CONNECTION_MANAGER_SCRIPT).toContain("owner-picker-hint");
    expect(CONNECTION_MANAGER_SCRIPT).toContain("owner-picker-badge");
    expect(CONNECTION_MANAGER_SCRIPT).toContain("row.label===row.id?undefined:row.id");
  });

  it("only claims default for the default owner", () => {
    expect(CONNECTION_MANAGER_SCRIPT).toContain('badge:row.isDefault?"default":undefined');
  });

  it("styles the three parts with hierarchy, not one weight", () => {
    expect(CONNECTION_MANAGER_STYLE).toContain(".integration .owner-picker-copy{display:flex;flex-direction:column");
    expect(CONNECTION_MANAGER_STYLE).toMatch(/\.integration \.owner-picker-hint\{[^}]*color:var\(--muted-foreground\)/);
    expect(CONNECTION_MANAGER_STYLE).toContain(".integration .owner-picker-badge{");
  });
});
