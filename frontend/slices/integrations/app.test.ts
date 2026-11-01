import { describe, expect, it } from "vitest";
import { managerLocation } from "./app";

// The integrations window renders an iframe. Every query parameter the user pasted has to survive
// into that iframe or a deep link silently lands on the generic manager page — which is exactly
// what happened before: only `transfer=1` was forwarded.

describe("managerLocation", () => {
  it("forwards the connection deep-link parameters", () => {
    expect(managerLocation("?user=dita&provider=convex&connection=dita-convex"))
      .toBe("/integrations/manager?user=dita&provider=convex&connection=dita-convex");
  });

  it("still forwards transfer", () => {
    expect(managerLocation("?transfer=1")).toBe("/integrations/manager?transfer=1");
  });

  it("keeps both when a deep link also asks for transfer", () => {
    expect(managerLocation("?transfer=1&user=dita&provider=convex&connection=dita-convex"))
      .toBe("/integrations/manager?transfer=1&user=dita&provider=convex&connection=dita-convex");
  });

  it("drops anything that is not part of the allowlist", () => {
    // `target` carried private capability material historically; it must not ride along.
    expect(managerLocation("?target=secret-token&user=dita&provider=convex&connection=c"))
      .toBe("/integrations/manager?user=dita&provider=convex&connection=c");
  });

  it("emits no query string at all when nothing is forwarded", () => {
    expect(managerLocation("")).toBe("/integrations/manager");
    expect(managerLocation("?target=x")).toBe("/integrations/manager");
  });

  it("preserves the hash", () => {
    expect(managerLocation("?user=u&provider=p&connection=c", "#row"))
      .toBe("/integrations/manager?user=u&provider=p&connection=c#row");
  });
});
