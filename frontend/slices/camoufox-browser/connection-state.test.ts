import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("keeps power truth and offers retry instead of an endless failed spinner", () => {
  const source = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
  expect(source).toContain("await verifyViewerTransport(signal)");
  expect(source).not.toContain("...current, running: false");
  expect(source).toContain("Retry connection");
  expect(source).toContain(") : !error ? (");
});
